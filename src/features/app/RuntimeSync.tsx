import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { appApi } from "@/api/app";
import { apiUrl } from "@/api/client";
import { appKeys } from "@/features/app/queries";
import { projectKeys } from "@/features/projects/queries";

type RuntimeChange = {
  revision: number;
  domains?: string[];
};

const FALLBACK_INTERVAL_MS = 30_000;

export function RuntimeSync() {
  const queryClient = useQueryClient();
  const revisionRef = useRef<number | null>(null);

  useEffect(() => {
    const invalidate = (domains: string[] = ["sidebar", "sessions", "processes"]) => {
      if (domains.includes("sidebar")) {
        void queryClient.invalidateQueries({ queryKey: projectKeys.sidebar });
      }
      if (domains.includes("sessions")) {
        void queryClient.invalidateQueries({ queryKey: ["project-sessions"] });
        void queryClient.invalidateQueries({ queryKey: ["workspace-sessions"] });
      }
      if (domains.includes("processes")) {
        void queryClient.invalidateQueries({ queryKey: appKeys.processes });
        void queryClient.invalidateQueries({ queryKey: appKeys.amux });
      }
    };

    const accept = (change: RuntimeChange, initial: boolean) => {
      const previous = revisionRef.current;
      if (previous !== null && change.revision <= previous) return;
      revisionRef.current = change.revision;
      if (!initial && previous !== null) invalidate(change.domains);
    };

    const events = new EventSource(apiUrl("/api/events"));
    events.addEventListener("runtime.sync", (event) => {
      try {
        accept(JSON.parse((event as MessageEvent<string>).data) as RuntimeChange, revisionRef.current === null);
      } catch {
        // The 30-second revision check recovers malformed or interrupted events.
      }
    });
    events.addEventListener("runtime.changed", (event) => {
      try {
        accept(JSON.parse((event as MessageEvent<string>).data) as RuntimeChange, false);
      } catch {
        // The 30-second revision check recovers malformed or interrupted events.
      }
    });

    const fallback = window.setInterval(() => {
      void appApi.runtimeRevision().then(({ revision }) => {
        const previous = revisionRef.current;
        if (previous === null) {
          revisionRef.current = revision;
        } else if (previous !== revision) {
          revisionRef.current = revision;
          invalidate();
        }
      }).catch(() => {
        // EventSource and the next fallback tick will retry independently.
      });
    }, FALLBACK_INTERVAL_MS);

    return () => {
      window.clearInterval(fallback);
      events.close();
    };
  }, [queryClient]);

  return null;
}

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { appApi } from "@/api/app";
import { apiUrl } from "@/api/client";
import { invalidateRuntimeQueries, type RuntimeDomain } from "@/features/app/runtimeInvalidation";

type RuntimeChange = {
  instance_id: string;
  revision: number;
  domains?: RuntimeDomain[];
};

const FALLBACK_INTERVAL_MS = 30_000;

export function RuntimeSync() {
  const queryClient = useQueryClient();
  const cursorRef = useRef<Pick<RuntimeChange, "instance_id" | "revision"> | null>(null);

  useEffect(() => {
    const accept = (change: RuntimeChange, sync: boolean) => {
      const previous = cursorRef.current;
      if (previous === null) {
        cursorRef.current = change;
        return;
      }
      if (change.instance_id !== previous.instance_id) {
        cursorRef.current = change;
        void invalidateRuntimeQueries(queryClient);
        return;
      }
      if (change.revision <= previous.revision) return;
      cursorRef.current = change;
      if (sync || change.revision !== previous.revision + 1) {
        void invalidateRuntimeQueries(queryClient);
        return;
      }
      void invalidateRuntimeQueries(queryClient, change.domains);
    };

    const events = new EventSource(apiUrl("/api/events"));
    events.addEventListener("runtime.sync", (event) => {
      try {
        accept(JSON.parse((event as MessageEvent<string>).data) as RuntimeChange, true);
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
      void appApi.runtimeRevision().then((cursor) => {
        accept(cursor, true);
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

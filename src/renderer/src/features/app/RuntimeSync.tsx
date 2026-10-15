import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { appApi } from "@/api/app";
import { logStreamState, streamUrl } from "@/api/client";
import { allRuntimeDomains, refreshRuntimeQueries, type RuntimeDomain } from "@/features/app/runtimeInvalidation";
import { createRuntimeRefreshScheduler } from "@/features/app/runtimeRefreshScheduler";
import { frontendLogger } from "@/lib/logger";

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
    let disposed = false;
    const refresh = createRuntimeRefreshScheduler<RuntimeDomain>(
      (domains, signal) => refreshRuntimeQueries(queryClient, domains, signal),
      cause => frontendLogger.error("Runtime refresh failed", cause),
    );
    const accept = (change: RuntimeChange, sync: boolean) => {
      if (disposed) return;
      const previous = cursorRef.current;
      if (previous === null) {
        cursorRef.current = change;
        return;
      }
      if (change.instance_id !== previous.instance_id) {
        cursorRef.current = change;
        refresh.request(allRuntimeDomains);
        return;
      }
      if (change.revision <= previous.revision) return;
      cursorRef.current = change;
      if (sync || change.revision !== previous.revision + 1) {
        refresh.request(allRuntimeDomains);
        return;
      }
      refresh.request(change.domains ?? allRuntimeDomains);
    };

    const events = new EventSource(streamUrl("/api/events"));
    events.onopen = () => logStreamState(events.url, "open");
    events.onerror = () => logStreamState(events.url, "error");
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
      disposed = true;
      refresh.dispose();
      window.clearInterval(fallback);
      events.close();
    };
  }, [queryClient]);

  return null;
}

import type { Query, QueryClient, QueryFilters } from "@tanstack/react-query";

type Refresh = { pending: boolean; promise: Promise<void> };
const refreshes = new WeakMap<QueryClient, Map<Query, Refresh>>();

/** Serialize each query's refreshes without making unrelated queries wait. */
export async function refreshQueries(
  client: QueryClient,
  filters: QueryFilters,
  { throwOnError = false }: { throwOnError?: boolean } = {},
) {
  let running = refreshes.get(client);
  if (!running) {
    running = new Map();
    refreshes.set(client, running);
  }
  const tasks = client.getQueryCache().findAll(filters).map(query => {
    query.invalidate();
    const current = running.get(query);
    if (current) {
      current.pending = true;
      return current.promise;
    }
    if (!query.isActive()) return Promise.resolve();
    const refresh: Refresh = { pending: true, promise: Promise.resolve() };
    running.set(query, refresh);
    refresh.promise = Promise.resolve().then(async () => {
      try {
        while (refresh.pending) {
          // An existing response may predate the change. Finish it, then fetch
          // again. Events received while waiting are covered by that next read.
          if (query.state.fetchStatus === "fetching") {
            await query.promise?.catch(() => {});
          }
          refresh.pending = false;
          query.invalidate();
          if (!query.isActive()) return;
          try {
            await client.refetchQueries({ queryKey: query.queryKey, exact: true }, {
              cancelRefetch: false, throwOnError: true,
            });
          } catch (error) {
            if (!refresh.pending) throw error;
          }
        }
      } finally {
        // Remove the queue before settling its promise so a new caller cannot
        // enqueue work onto an already completed refresh.
        running.delete(query);
      }
    });
    return refresh.promise;
  });
  const results = await Promise.allSettled(tasks);
  const failure = results.find(result => result.status === "rejected");
  if (throwOnError && failure?.status === "rejected") throw failure.reason;
}

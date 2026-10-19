import { test, expect } from "@playwright/test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { refreshQueries } from "../../src/renderer/src/features/app/refreshQueries.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("query refreshes preserve changes during a slow read while other queries keep updating", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const gate = deferred();
  let state = "active";
  let slowReads = 0;
  let aborted = 0;
  const slow = new QueryObserver(client, {
    queryKey: ["workspace"], initialData: state,
    queryFn: async ({ signal }) => {
      signal.addEventListener("abort", () => aborted++);
      const snapshot = state;
      if (++slowReads === 1) await gate.promise;
      return snapshot;
    },
  });
  const fast = new QueryObserver(client, { queryKey: ["sidebar"], initialData: state, queryFn: async () => state });
  const unsubscribe = [slow.subscribe(() => {}), fast.subscribe(() => {})];
  try {
    const first = refreshQueries(client, {});
    await expect.poll(() => slowReads).toBe(1);
    state = "archived";
    const queued = Array.from({ length: 20 }, () => refreshQueries(client, {}));
    await expect.poll(() => client.getQueryData(["sidebar"])).toBe("archived");
    expect(slowReads).toBe(1);
    expect(aborted).toBe(0);
    gate.resolve();
    await Promise.all([first, ...queued]);
    expect(client.getQueryData(["workspace"])).toBe("archived");
    expect(slowReads).toBe(2);
    expect(aborted).toBe(0);
  } finally {
    gate.resolve();
    unsubscribe.forEach(stop => stop());
    client.clear();
  }
});

test("refresh waits for a pre-existing read and leaves hidden queries stale", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const gate = deferred();
  let value = "before";
  let reads = 0;
  const observer = new QueryObserver(client, {
    queryKey: ["project"], initialData: value,
    queryFn: async () => {
      const snapshot = value;
      if (++reads === 1) await gate.promise;
      return snapshot;
    },
  });
  const stop = observer.subscribe(() => {});
  try {
    const existing = client.refetchQueries({ queryKey: ["project"] });
    await expect.poll(() => reads).toBe(1);
    value = "after";
    const refresh = refreshQueries(client, {});
    gate.resolve();
    await Promise.all([existing, refresh]);
    expect(reads).toBe(2);
    expect(client.getQueryData(["project"])).toBe("after");
    stop();
    value = "hidden change";
    await refreshQueries(client, {});
    expect(reads).toBe(2);
    expect(client.getQueryState(["project"])?.isInvalidated).toBe(true);
    const resume = observer.subscribe(() => {});
    await expect.poll(() => client.getQueryData(["project"])).toBe("hidden change");
    resume();
  } finally {
    gate.resolve();
    stop();
    client.clear();
  }
});

test("a failed query does not block other updates or later refreshes", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  let fail = true;
  const slow = new QueryObserver(client, { queryKey: ["project-worktrees"], initialData: "old", queryFn: async () => {
    if (fail) throw new Error("offline");
    return "updated";
  } });
  const fast = new QueryObserver(client, { queryKey: ["project"], initialData: "active", queryFn: async () => "archived" });
  const unsubscribe = [slow.subscribe(() => {}), fast.subscribe(() => {})];
  try {
    await expect(refreshQueries(client, {}, { throwOnError: true })).rejects.toThrow("offline");
    expect(client.getQueryData(["project"])).toBe("archived");
    fail = false;
    await refreshQueries(client, {});
    expect(client.getQueryData(["project-worktrees"])).toBe("updated");
  } finally {
    unsubscribe.forEach(stop => stop());
    client.clear();
  }
});

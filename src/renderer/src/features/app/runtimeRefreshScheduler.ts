/** Coalesce event bursts without starving refreshes during continuous activity. */
export function createRuntimeRefreshScheduler<Domain extends string>(
  refresh: (domains: Domain[], signal: AbortSignal) => Promise<void>,
  onError: (cause: unknown) => void,
) {
  const pending = new Set<Domain>();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let disposed = false;

  const schedule = () => {
    if (disposed || running || timer !== undefined || pending.size === 0) return;
    timer = setTimeout(() => void flush(), 100);
  };
  const flush = async () => {
    timer = undefined;
    const domains = [...pending];
    pending.clear();
    running = true;
    try {
      await refresh(domains, controller.signal);
    } catch (cause) {
      onError(cause);
    } finally {
      running = false;
      // Changes received during a request need one trailing refresh, even when
      // that request succeeds: its response may predate those changes.
      schedule();
    }
  };

  return {
    request(domains: readonly Domain[]) {
      if (disposed) return;
      for (const domain of domains) pending.add(domain);
      schedule();
    },
    dispose() {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      pending.clear();
    },
  };
}

/** Coalesce event bursts; individual query queues own in-flight refreshes. */
export function createRuntimeRefreshScheduler<Domain extends string>(
  refresh: (domains: Domain[], signal: AbortSignal) => Promise<void>,
  onError: (cause: unknown) => void,
) {
  const pending = new Set<Domain>();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const schedule = () => {
    if (disposed || timer !== undefined || pending.size === 0) return;
    timer = setTimeout(() => void flush(), 100);
  };
  const flush = async () => {
    timer = undefined;
    const domains = [...pending];
    pending.clear();
    try {
      await refresh(domains, controller.signal);
    } catch (cause) {
      onError(cause);
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

import type { OpenProjectRequest } from '../preload/bridge.d.ts';

// Retain the latest request until the renderer has handled it, including cold start
// and reloads. A stale acknowledgement cannot clear a newer request.
export function createProjectOpenRequests(notify: (request: OpenProjectRequest) => void) {
  let sequence = 0;
  let pending: OpenProjectRequest | null = null;
  return {
    receive(path: string) {
      pending = { id: ++sequence, path };
      notify(pending);
    },
    pending: () => pending,
    acknowledge(id: number) { if (pending?.id === id) pending = null; },
  };
}

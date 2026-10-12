import { gt, prerelease, valid } from 'semver';
import type { UpdateCheckResult } from '../preload/bridge.d.ts';

export const stableReleaseEndpoint = 'https://api.github.com/repos/win5do/treefold/releases/latest';
export const startupUpdateDelay = 30_000;

export function createUpdateChecker(currentVersion: string, fetchRelease: (url: string, init: RequestInit) => Promise<Response> = fetch) {
  let pending: Promise<UpdateCheckResult> | undefined;
  async function request(): Promise<UpdateCheckResult> {
    try {
      const response = await fetchRelease(stableReleaseEndpoint, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 404) return { status: 'no-stable-release' };
      if (!response.ok) throw new Error(`Release check returned ${response.status}`);
      const release: unknown = await response.json();
      if (!release || typeof release !== 'object' || !('tag_name' in release)
        || typeof release.tag_name !== 'string' || !('draft' in release)
        || !('prerelease' in release) || typeof release.draft !== 'boolean'
        || typeof release.prerelease !== 'boolean') throw new Error('Invalid release');
      const version = valid(release.tag_name);
      if (!version || !valid(currentVersion)) throw new Error('Invalid version');
      // Defense in depth: neither the GitHub flag nor the tag may be a prerelease.
      if (release.draft || release.prerelease || prerelease(version)) return { status: 'no-stable-release' };
      if (!gt(version, currentVersion)) return { status: 'up-to-date' };
      return { status: 'available', version,
        url: `https://github.com/win5do/treefold/releases/tag/${encodeURIComponent(release.tag_name)}` };
    } catch {
      return { status: 'error' };
    }
  }
  return () => pending ??= request().finally(() => { pending = undefined; });
}

export function scheduleStartupUpdate(
  enabled: boolean,
  check: () => Promise<UpdateCheckResult>,
  notify: (result: Extract<UpdateCheckResult, { status: 'available' }>) => void,
) {
  let disposed = false;
  const timer = enabled ? setTimeout(() => {
    void check().then(result => {
      if (!disposed && result.status === 'available') notify(result);
    }).catch(() => {});
  }, startupUpdateDelay) : undefined;
  timer?.unref();
  return () => { disposed = true; clearTimeout(timer); };
}

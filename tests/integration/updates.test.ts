import { test, expect } from '@playwright/test';
import { mock } from 'node:test';
import { createUpdateChecker, scheduleStartupUpdate, stableReleaseEndpoint } from '../../src/main/updates.ts';
import type { UpdateCheckResult } from '../../src/preload/bridge.d.ts';
import { shouldNotifyUpdate, updateReminderDelay, updateReminderPatch } from '../../src/renderer/src/features/updates/reminders.ts';

test('update reminders silence every version for seven days or skip only the selected version', () => {
  const now = Date.UTC(2026, 9, 14);
  const defaults = { skipped_version: null, remind_after: null };
  expect(shouldNotifyUpdate('1.0.0', defaults, now)).toBe(true);
  const later = updateReminderPatch('later', '1.0.0', now);
  expect(later.updates.remind_after).toBe(now + 7 * 24 * 60 * 60 * 1_000);
  const snoozed = { ...defaults, ...later.updates };
  expect(shouldNotifyUpdate('1.0.0', snoozed, now + updateReminderDelay - 1)).toBe(false);
  expect(shouldNotifyUpdate('2.0.0', snoozed, now + updateReminderDelay - 1)).toBe(false);
  expect(shouldNotifyUpdate('1.0.0', snoozed, now + updateReminderDelay)).toBe(true);
  const skipped = { ...defaults, ...updateReminderPatch('skip', '1.0.0', now).updates };
  expect(shouldNotifyUpdate('1.0.0', skipped, now + 30 * updateReminderDelay)).toBe(false);
  expect(shouldNotifyUpdate('1.0.1', skipped, now)).toBe(true);
  expect(updateReminderPatch('later', '1.0.0', now + 1_000).updates.remind_after).toBe(now + 1_000 + updateReminderDelay);
});

const release = (tag_name: string, extra = {}) => ({ tag_name, draft: false, prerelease: false, ...extra });

for (const [current, tag, extra, status] of [
  ['0.1.0-alpha.3', 'v0.1.0', {}, 'available'],
  ['0.1.0-dev.20261014010203', 'v0.1.0', {}, 'available'],
  ['0.1.9', 'v0.1.10', {}, 'available'],
  ['0.2.0', 'v0.1.0', {}, 'up-to-date'],
  ['0.1.0', 'v0.1.0', {}, 'up-to-date'],
  ['0.1.0', 'v0.2.0-alpha.1', {}, 'no-stable-release'],
  ['0.1.0', 'v0.2.0', { prerelease: true }, 'no-stable-release'],
  ['0.1.0', 'v0.2.0', { draft: true }, 'no-stable-release'],
  ['0.1.0', 'invalid', {}, 'error'],
] as const) {
  test(`stable update policy: ${current} → ${tag} ${JSON.stringify(extra)}`, async () => {
    const check = createUpdateChecker(current, async (url, init) => {
      expect(url).toBe(stableReleaseEndpoint);
      expect(init?.signal).toBeDefined();
      return Response.json(release(tag, extra));
    });
    const result = await check();
    expect(result.status).toBe(status);
    if (result.status === 'available') {
      expect(result.url).toBe(`https://github.com/win5do/treefold/releases/tag/${tag}`);
    }
  });
}

test('missing stable release differs from network, rate limit and malformed responses', async () => {
  expect(await createUpdateChecker('0.1.0', async () => new Response(null, { status: 404 }))()).toEqual({ status: 'no-stable-release' });
  for (const fetcher of [
    async () => new Response(null, { status: 403 }),
    async () => { throw new Error('offline'); },
    async () => Response.json({ tag_name: 'v1.0.0' }),
    async () => new Response('not json'),
  ]) expect(await createUpdateChecker('0.1.0', fetcher)()).toEqual({ status: 'error' });
});

test('concurrent checks share a request and a later manual check can retry', async () => {
  let calls = 0;
  let resolve!: (response: Response) => void;
  const check = createUpdateChecker('0.1.0', () => {
    calls++;
    return new Promise<Response>(done => { resolve = done; });
  });
  const first = check();
  const second = check();
  expect(calls).toBe(1);
  resolve(new Response(null, { status: 503 }));
  expect(await first).toEqual({ status: 'error' });
  expect(await second).toEqual({ status: 'error' });
  const retry = check();
  expect(calls).toBe(2);
  resolve(Response.json(release('v0.2.0', { html_url: 'https://untrusted.example' })));
  expect(await retry).toEqual({ status: 'available', version: '0.2.0', url: 'https://github.com/win5do/treefold/releases/tag/v0.2.0' });
});

test('startup checks once at 30 seconds, only announces updates, and cancels on quit', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const notices: UpdateCheckResult[] = [];
    let checks = 0;
    const available: UpdateCheckResult = { status: 'available', version: '1.0.0', url: 'https://github.com/win5do/treefold/releases/tag/v1.0.0' };
    const check = async () => { checks++; return available; };
    const cancel = scheduleStartupUpdate(true, check, result => notices.push(result));
    mock.timers.tick(29_999);
    expect(checks).toBe(0);
    mock.timers.tick(1);
    await Promise.resolve();
    expect(checks).toBe(1);
    expect(notices).toEqual([available]);
    mock.timers.tick(60_000);
    expect(checks).toBe(1);
    cancel();
    const cancelBeforeStart = scheduleStartupUpdate(true, check, result => notices.push(result));
    cancelBeforeStart();
    scheduleStartupUpdate(false, check, result => notices.push(result));
    for (const status of ['up-to-date', 'no-stable-release', 'error'] as const) {
      scheduleStartupUpdate(true, async () => ({ status }), result => notices.push(result));
    }
    mock.timers.tick(30_000);
    await Promise.resolve();
    expect(checks).toBe(1);
    expect(notices).toEqual([available]);
    let complete!: (result: UpdateCheckResult) => void;
    const cancelDuringCheck = scheduleStartupUpdate(true, () => new Promise(done => { complete = done; }), result => notices.push(result));
    mock.timers.tick(30_000);
    cancelDuringCheck();
    complete(available);
    await Promise.resolve();
    expect(notices).toEqual([available]);
  } finally { mock.timers.reset(); }
});

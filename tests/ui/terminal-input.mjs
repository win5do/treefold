import assert from "node:assert/strict";
import { startUiHarness } from "./ui-harness.mjs";
import { closeUiSession, createUiSession } from "./harness/session.mjs";

const harness = await startUiHarness();
let browser;

try {
  browser = await createUiSession({ sessionName: "terminal-input" });
  await browser.url(harness.baseUrl);
  await (await browser.$('[data-testid="workspace-sidebar"]')).waitForDisplayed({ timeout: 10_000 });

  const result = await browser.executeAsync(async (done) => {
    try {
      const input = await import("/src/features/terminal/inputQueue.ts");
      const oversized = input.prepareTerminalInput("x".repeat(input.maxSinglePasteBytes + 1), 0);
      const smallAfterRejection = input.prepareTerminalInput("echo ok\r", 0);
      const queued = input.prepareTerminalInput("x", input.maxQueuedBytes);
      const framed = input.prepareTerminalInput("x".repeat(input.terminalInputFrameBytes + 1), 0);
      done({ oversized, smallAfterRejection, queued, frameSizes: framed.accepted ? framed.frames.map((frame) => frame.byteLength) : [] });
    } catch (error) {
      done({ error: String(error) });
    }
  });

  assert.equal(result.error, undefined);
  assert.deepEqual(result.oversized, { accepted: false, reason: "single-input-too-large", pauseStdin: false }, "an oversized paste must be rejected atomically without pausing stdin");
  assert.equal(result.smallAfterRejection.accepted, true, "small input must still be accepted after rejecting a large paste");
  assert.equal(result.smallAfterRejection.byteLength, 8, "small input must not inherit any prefix from a rejected paste");
  assert.deepEqual(result.queued, { accepted: false, reason: "queue-full", pauseStdin: true }, "a full reconnect queue must retain the stdin pause mechanism");
  assert.deepEqual(result.frameSizes, [16 * 1024, 1], "accepted input must retain 16 KiB WebSocket framing");

  harness.assertNoUnexpectedRequests();
  console.log("✓ terminal input rejects oversized pastes atomically and preserves queue backpressure");
} finally {
  await closeUiSession(browser);
  await harness.close();
}

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
      const queue = new input.ReliableTerminalInputQueue();
      const oversized = queue.enqueue("x".repeat(input.maxSinglePasteBytes + 1));
      const first = queue.enqueue("echo ");
      const second = queue.enqueue("你好\r");
      const sent = [queue.takeUnsent(), queue.takeUnsent()].map((frame) => frame && JSON.parse(frame.wire));
      const pendingBeforeAck = queue.pendingBytes;
      const acknowledged = queue.acknowledge(1);
      const pendingAfterAck = queue.pendingBytes;
      queue.reconnect();
      const resent = queue.takeUnsent();

      const framedQueue = new input.ReliableTerminalInputQueue();
      framedQueue.enqueue("x".repeat(input.terminalInputFrameBytes + 1));
      const frameSizes = [];
      while (framedQueue.hasUnsent) {
        const frame = framedQueue.takeUnsent();
        frameSizes.push(atob(JSON.parse(frame.wire).data).length);
      }

      const fullQueue = new input.ReliableTerminalInputQueue();
      const pausesAtHighWater = fullQueue.enqueue("x".repeat(input.pauseQueuedBytes)).pauseStdin;
      fullQueue.enqueue("y".repeat(input.maxQueuedBytes - input.pauseQueuedBytes));
      const queued = fullQueue.enqueue("z");
      done({ oversized, first, second, sent, pendingBeforeAck, acknowledged, pendingAfterAck, resent: resent && JSON.parse(resent.wire), frameSizes, pausesAtHighWater, queued });
    } catch (error) {
      done({ error: String(error) });
    }
  });

  assert.equal(result.error, undefined);
  assert.deepEqual(result.oversized, { accepted: false, reason: "single-input-too-large", pauseStdin: false }, "an oversized paste must be rejected atomically without pausing stdin");
  assert.deepEqual(result.first, { accepted: true, byteLength: 5, pauseStdin: false });
  assert.deepEqual(result.second, { accepted: true, byteLength: 7, pauseStdin: false }, "UTF-8 input must retain its byte length");
  assert.deepEqual(result.sent.map(({ type, sequence }) => ({ type, sequence })), [{ type: "input", sequence: 1 }, { type: "input", sequence: 2 }]);
  assert.equal(result.pendingBeforeAck, 12, "sent input must remain queued until acknowledged");
  assert.equal(result.acknowledged, true);
  assert.equal(result.pendingAfterAck, 7, "a cumulative acknowledgement must release only confirmed bytes");
  assert.equal(result.resent.sequence, 2, "reconnect must resend the first unacknowledged frame with the same sequence");
  assert.deepEqual(result.queued, { accepted: false, reason: "queue-full", pauseStdin: true }, "a full reconnect queue must retain the stdin pause mechanism");
  assert.deepEqual(result.frameSizes, [16 * 1024, 1], "accepted input must retain 16 KiB WebSocket framing");
  assert.equal(result.pausesAtHighWater, true, "stdin must pause before the hard queue limit is reached");

  harness.assertNoUnexpectedRequests();
  console.log("✓ terminal input stays queued until acknowledgement and replays safely after reconnect");
} finally {
  await closeUiSession(browser);
  await harness.close();
}

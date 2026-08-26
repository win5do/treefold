import assert from "node:assert/strict";
import { startUiHarness } from "./ui-harness.mjs";
import { closeUiSession, createUiSession } from "./harness/session.mjs";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.mjs";

const harness = await startUiHarness();
let browser;

try {
  browser = await createUiSession({ sessionName: "terminal-input" });
  await browser.url(harness.baseUrl);
  await (await browser.$('[data-testid="workspace-sidebar"]')).waitForDisplayed({ timeout: 10_000 });

  const result = await browser.executeAsync(async (done) => {
    try {
      const input = await import("/src/features/terminal/inputQueue.ts");
      const runtimeModule = await import("/src/features/terminal/runtime.ts");
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
      const controllerClientId = runtimeModule.terminalControllerClientId();
      const controllerClientIdAgain = runtimeModule.terminalControllerClientId();
      const runtime = runtimeModule.createTerminalRuntime();
      const frame = new ArrayBuffer(11);
      new DataView(frame).setBigUint64(0, 42n, false);
      new Uint8Array(frame, 8).set([65, 66, 67]);
      const decoded = runtimeModule.decodeSequencedOutput(frame);
      const accepted = [
        runtimeModule.acceptOutputSequence(runtime, 42n),
        runtimeModule.acceptOutputSequence(runtime, 42n),
        runtimeModule.acceptOutputSequence(runtime, 41n),
        runtimeModule.acceptOutputSequence(runtime, 43n),
      ];
      done({ oversized, first, second, sent, pendingBeforeAck, acknowledged, pendingAfterAck, resent: resent && JSON.parse(resent.wire), frameSizes, pausesAtHighWater, queued, controllerClientId, controllerClientIdAgain, inputClientId: runtime.inputClientId, decodedSequence: decoded?.sequence.toString(), decodedData: decoded && [...decoded.data], accepted, lastOutputSequence: runtime.lastOutputSequence?.toString() });
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
  assert.equal(result.controllerClientIdAgain, result.controllerClientId, "the controller identity must remain stable for the browser window");
  assert.notEqual(result.inputClientId, result.controllerClientId, "the input queue lifecycle must have an independent identity");
  assert.equal(result.decodedSequence, "42");
  assert.deepEqual(result.decodedData, [65, 66, 67]);
  assert.deepEqual(result.accepted, [true, false, false, true], "duplicate and out-of-order terminal output must be filtered");
  assert.equal(result.lastOutputSequence, "43");

  await browser.execute((workspaceId, sessionId) => {
    window.__terminalSocketUrls = [];
    window.__terminalSocketSends = [];
    class ReadonlyTerminalSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = ReadonlyTerminalSocket.CONNECTING;
      bufferedAmount = 0;
      binaryType = "blob";
      onopen = null;
      onmessage = null;
      onclose = null;
      onerror = null;
      constructor(url) {
        super();
        window.__terminalSocketUrls.push(String(url));
        setTimeout(() => {
          if (this.readyState !== ReadonlyTerminalSocket.CONNECTING) return;
          this.readyState = ReadonlyTerminalSocket.OPEN;
          this.onopen?.(new Event("open"));
          this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "output_cursor", sequence: "0" }) }));
          this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "ownership_state", state: "readonly" }) }));
        }, 0);
      }
      send(data) { window.__terminalSocketSends.push(String(data)); }
      close() {
        if (this.readyState === ReadonlyTerminalSocket.CLOSED) return;
        this.readyState = ReadonlyTerminalSocket.CLOSED;
        this.onclose?.(new CloseEvent("close"));
      }
    }
    window.WebSocket = ReadonlyTerminalSocket;
    window.location.hash = `#/workspaces/${workspaceId}/sessions/${sessionId}`;
  }, FIXTURE_IDS.workspace, FIXTURE_IDS.workspaceShell);
  const readonly = await browser.$('[data-testid="terminal-readonly-indicator"]');
  await readonly.waitForDisplayed({ timeout: 3_000 });
  assert.equal(await readonly.getText(), "Read only");
  const socketLifecycle = await browser.execute(() => ({ urls: window.__terminalSocketUrls, sends: window.__terminalSocketSends }));
  assert.ok(socketLifecycle.urls.length >= 2, "StrictMode must exercise terminal effect cleanup and reconnect");
  const identities = socketLifecycle.urls.map((value) => {
    const url = new URL(value);
    return [url.searchParams.get("controller_client_id"), url.searchParams.get("input_client_id")];
  });
  assert.ok(identities.every(([controller, input]) => controller === identities[0][0] && input === identities[0][1]), "StrictMode reconnects must reuse both lifecycle identities");
  assert.deepEqual(socketLifecycle.sends, [], "a read-only terminal must not send resize or stdin control frames");

  harness.assertNoUnexpectedRequests();
  console.log("✓ terminal runtime preserves identities and filters replayed input and output");
} finally {
  await closeUiSession(browser);
  await harness.close();
}

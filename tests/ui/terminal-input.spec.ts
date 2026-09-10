import { test, expect, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

test("terminal-input", async () => {
  const harness = await startUiHarness();
  let page!: Page;

  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "terminal-input" });
    await page.goto(harness.baseUrl);
    await (page.locator('[data-testid="workspace-sidebar"]')).waitFor({ timeout: 10_000, state: 'visible' });

    const result = await page.evaluate(async () => {
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
          frameSizes.push(atob(JSON.parse(frame!.wire).data).length);
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
        return { oversized, first, second, sent, pendingBeforeAck, acknowledged, pendingAfterAck, resent: resent && JSON.parse(resent.wire), frameSizes, pausesAtHighWater, queued, controllerClientId, controllerClientIdAgain, inputClientId: runtime.inputClientId, decodedSequence: decoded?.sequence.toString(), decodedData: decoded && [...decoded.data], accepted, lastOutputSequence: runtime.lastOutputSequence?.toString() };
      } catch (error) {
        return { error: String(error) };
      }
    });

    assert.equal(result.error, undefined);
    assert.ok(!("error" in result));
    assert.deepEqual(result.oversized, { accepted: false, reason: "single-input-too-large", pauseStdin: false }, "an oversized paste must be rejected atomically without pausing stdin");
    assert.deepEqual(result.first, { accepted: true, byteLength: 5, pauseStdin: false });
    assert.deepEqual(result.second, { accepted: true, byteLength: 7, pauseStdin: false }, "UTF-8 input must retain its byte length");
    assert.deepEqual(result.sent.map(({ type, sequence }: { type: string; sequence: number }) => ({ type, sequence })), [{ type: "input", sequence: 1 }, { type: "input", sequence: 2 }]);
    assert.equal(result.pendingBeforeAck, 12, "sent input must remain queued until acknowledged");
    assert.equal(result.acknowledged, true);
    assert.equal(result.pendingAfterAck, 7, "a cumulative acknowledgement must release only confirmed bytes");
    assert.equal(result.resent.sequence, 2, "reconnect must resend the first unacknowledged frame with the same sequence");
    assert.deepEqual(result.queued, { accepted: false, reason: "queue-full", pauseStdin: true }, "a full reconnect queue must retain the stdin pause mechanism");
    assert.deepEqual(result.frameSizes, [16 * 1024, 1], "accepted input must retain 16 KiB WebSocket framing");
    assert.equal(result.pausesAtHighWater, true, "stdin must pause before the hard queue limit is reached");
    assert.equal(result.controllerClientIdAgain, result.controllerClientId, "the controller identity must remain stable for the page window");
    assert.notEqual(result.inputClientId, result.controllerClientId, "the input queue lifecycle must have an independent identity");
    assert.equal(result.decodedSequence, "42");
    assert.deepEqual(result.decodedData, [65, 66, 67]);
    assert.deepEqual(result.accepted, [true, false, false, true], "duplicate and out-of-order terminal output must be filtered");
    assert.equal(result.lastOutputSequence, "43");

    await page.evaluate(([workspaceId, sessionId]) => {
      window.__terminalInputFrames = [];
      window.__terminalControllerReady = false;
      class ControllerTerminalSocket extends EventTarget {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        readyState = ControllerTerminalSocket.CONNECTING;
        bufferedAmount = 0;
        binaryType = "blob";
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        constructor() {
          super();
          setTimeout(() => {
            if (this.readyState !== ControllerTerminalSocket.CONNECTING) return;
            this.readyState = ControllerTerminalSocket.OPEN;
            this.onopen?.(new Event("open"));
            this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "output_cursor", sequence: "0" }) }));
            this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "ownership_state", state: "controller" }) }));
            window.__terminalControllerReady = true;
          }, 0);
        }
        send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
          if (typeof data !== "string") return;
          let message;
          try { message = JSON.parse(data); } catch { return; }
          if (message.type !== "input") return;
          window.__terminalInputFrames.push(message);
          setTimeout(() => {
            if (this.readyState !== ControllerTerminalSocket.OPEN) return;
            this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "input_ack", client_id: message.client_id, sequence: message.sequence }) }));
          }, 0);
        }
        close() {
          if (this.readyState === ControllerTerminalSocket.CLOSED) return;
          this.readyState = ControllerTerminalSocket.CLOSED;
          this.onclose?.(new CloseEvent("close"));
        }
      }
      // These test doubles implement only the socket surface used by the terminal.
      window.WebSocket = ControllerTerminalSocket as unknown as typeof WebSocket;
      window.location.hash = `#/workspaces/${workspaceId}/sessions/${sessionId}`;
    }, [FIXTURE_IDS.workspace, FIXTURE_IDS.workspaceShell]);

    const helperTextarea = page.locator(".xterm-helper-textarea");
    await helperTextarea.waitFor({ timeout: 3_000, state: 'attached' });
    await expect.poll(async () => page.evaluate(() => {
      const textarea = document.querySelector(".xterm-helper-textarea");
      return window.__terminalControllerReady === true && textarea instanceof HTMLTextAreaElement && !textarea.disabled;
    }), { timeout: 3_000, message: "terminal controller did not enable stdin" }).toBeTruthy();

    const imeResult = await page.evaluate(async () => {
      try {
        const textarea = document.querySelector(".xterm-helper-textarea");
        if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("xterm helper textarea is missing");
        const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const insert = (data: string) => {
          textarea.value += data;
          textarea.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            composed: true,
            data,
            inputType: "insertText",
          }));
        };
        const key = (type: string, value: string, keyCode: number, isComposing = false) => {
          const event = new KeyboardEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: value,
            code: value.length === 1 && /[a-z]/i.test(value) ? `Key${value.toUpperCase()}` : value,
          });
          Object.defineProperty(event, "keyCode", { get: () => keyCode });
          Object.defineProperty(event, "which", { get: () => keyCode });
          Object.defineProperty(event, "isComposing", { get: () => isComposing });
          textarea.dispatchEvent(event);
        };
        const decodedInput = () => window.__terminalInputFrames.map((frame) => {
          const binary = atob(frame.data);
          return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
        }).join("");
        const takeInput = async () => {
          await sleep(40);
          const value = decodedInput();
          window.__terminalInputFrames = [];
          return value;
        };

        insert("g");
        key("keydown", "g", 229);
        await sleep(30);
        insert("i");
        key("keydown", "i", 229);
        insert("t");
        key("keydown", "t", 229);
        key("keyup", "g", 71);
        key("keyup", "i", 73);
        key("keyup", "t", 84);
        const rollover = await takeInput();

        key("keydown", "a", 229);
        insert("a");
        key("keyup", "a", 65);
        const keydownFirst = await takeInput();

        key("keydown", "Shift", 16);
        insert("G");
        key("keydown", "G", 229);
        key("keyup", "G", 71);
        key("keyup", "Shift", 16);
        const modifierOverlap = await takeInput();

        textarea.value = "";
        textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, composed: true, data: "" }));
        textarea.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, composed: true, data: "拼" }));
        textarea.value = "拼";
        textarea.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          composed: true,
          data: "拼",
          inputType: "insertCompositionText",
          isComposing: true,
        }));
        textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, composed: true, data: "拼" }));
        const composition = await takeInput();

        return { rollover, keydownFirst, modifierOverlap, composition };
      } catch (error) {
        return { error: String(error) };
      }
    });
    assert.equal(imeResult.error, undefined);
    assert.ok(!("error" in imeResult));
    assert.equal(imeResult.rollover, "git", "IME key rollover must emit every character exactly once");
    assert.equal(imeResult.keydownFirst, "a", "keydown-first IME delivery must retain native insertText");
    assert.equal(imeResult.modifierOverlap, "G", "an overlapping modifier must replay only the input xterm dropped");
    assert.equal(imeResult.composition, "拼", "real composition input must remain owned by xterm");

    await page.evaluate(([workspaceId, sessionId]) => {
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
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        constructor(url: string | URL) {
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
        send(data: string | ArrayBufferLike | Blob | ArrayBufferView) { window.__terminalSocketSends.push(String(data)); }
        close() {
          if (this.readyState === ReadonlyTerminalSocket.CLOSED) return;
          this.readyState = ReadonlyTerminalSocket.CLOSED;
          this.onclose?.(new CloseEvent("close"));
        }
      }
      window.WebSocket = ReadonlyTerminalSocket as unknown as typeof WebSocket;
      window.location.hash = `#/workspaces/${workspaceId}/sessions/${sessionId}`;
    }, [FIXTURE_IDS.workspace, FIXTURE_IDS.sessionDevServer]);
    const readonly = page.locator('[data-testid="terminal-readonly-indicator"]');
    await readonly.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(await readonly.innerText(), "Read only");
    const socketLifecycle = await page.evaluate(() => ({ urls: window.__terminalSocketUrls, sends: window.__terminalSocketSends }));
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
    try { await closeUiSession(page); } finally { await harness.close(); }
  }

});


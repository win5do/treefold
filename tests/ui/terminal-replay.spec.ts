import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import type { Session } from "../../src/renderer/src/domain/types.ts";

test("terminal preserves cleared screen and split ANSI state across Session switches", async () => {
  const harness = await startUiHarness();
  harness.setProcessState(FIXTURE_IDS.workspaceCodex, "running");
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "terminal-replay" });
    await page.addInitScript((sessionId) => {
      window.__terminalReplay = {
        // Larger than the former byte-tail limit, with state at the beginning.
        outputs: ["\x1b]10;?\x1b\\\x1b]11;?\x1b\\\x1b[2J\x1b[HBefore clear" + "\x1b[0m".repeat(20_000)],
        cursors: [], delivered: 0, responses: "",
      };
      class ReplaySocket extends EventTarget {
        static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
        readyState = 0;
        bufferedAmount = 0;
        binaryType = "blob";
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        target: boolean;
        clientId: string | null;
        cursor: string | null;
        prepared = false;
        constructor(value: string | URL) {
          super();
          const url = new URL(value);
          this.clientId = url.searchParams.get("input_client_id");
          this.target = url.pathname.includes(sessionId);
          const cursor = url.searchParams.get("after_output_sequence");
          this.cursor = cursor;
          setTimeout(() => {
            if (this.readyState !== 0) return;
            this.readyState = 1;
            this.onopen?.(new Event("open"));
            if (this.target) {
              window.__terminalReplay.cursors.push(cursor ?? "missing");
              this.control({ type: "output_cursor", sequence: cursor ?? "0" });
            }
            this.control({ type: "ownership_state", state: "controller" });
          }, 0);
        }
        control(value: unknown) {
          this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(value) }));
        }
        output(sequence: number, text: string) {
          const encoded = new TextEncoder().encode(text);
          const frame = new Uint8Array(8 + encoded.length);
          new DataView(frame.buffer).setBigUint64(0, BigInt(sequence));
          frame.set(encoded, 8);
          this.onmessage?.(new MessageEvent("message", { data: frame.buffer }));
          window.__terminalReplay.delivered = sequence;
        }
        send(value: string) {
          const message = JSON.parse(value);
          if (message.type === "terminal_ready" && this.target && !this.prepared) {
            this.prepared = true;
            window.__terminalReplay.outputs.forEach((output, index) => {
              if (index + 1 > Number(this.cursor ?? 0)) this.output(index + 1, output);
            });
          }
          if (message.type !== "input") return;
          window.__terminalReplay.responses += atob(message.data);
          this.control({ type: "input_ack", client_id: this.clientId, sequence: message.sequence });
          if (this.target && atob(message.data) === "\x0c") {
            // Simulate the application's Ctrl+L repaint, then detach mid-SGR.
            for (const output of ["\x1b[2J\x1b[HAfter clear", "\x1b[48;2;45;"]) {
              window.__terminalReplay.outputs.push(output);
              this.output(window.__terminalReplay.outputs.length, output);
            }
          }
        }
        close() { this.readyState = 3; this.onclose?.(new CloseEvent("close")); }
      }
      window.WebSocket = ReplaySocket as unknown as typeof WebSocket;
    }, FIXTURE_IDS.workspaceCodex);
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}/sessions/${FIXTURE_IDS.workspaceCodex}`);
    await expect.poll(() => page!.evaluate(() => window.__terminalReplay.delivered)).toBe(1);
    await expect.poll(() => page!.evaluate(() => window.__terminalReplay.responses)).toMatch(/\x1b\]11;rgb:[0-9a-f]+\/[0-9a-f]+\/[0-9a-f]+/i);
    await page.locator(".xterm-helper-textarea").press("Control+l");
    await expect.poll(() => page!.evaluate(() => window.__terminalReplay.delivered)).toBe(3);

    const identity = await (await page.request.get(`${harness.apiUrl}/api/sessions/${FIXTURE_IDS.workspaceCodex}`)).json() as Session;
    const leaveSession = async () => {
      await page!.evaluate((id) => { window.location.hash = `#/workspaces/${id}`; }, FIXTURE_IDS.workspace);
      await expect(page!.locator(".xterm-helper-textarea")).toHaveCount(0);
    };
    const cachedScreen = () => page!.evaluate(async (session) => {
      const cache = await import("/src/features/terminal/sessionCache.ts");
      const value = cache.takeTerminalSession(session);
      if (!value) throw new Error("Session terminal state was discarded on navigation");
      try {
        await new Promise<void>((resolve) => value.terminal.write("", resolve));
        return {
          firstLine: value.terminal.buffer.active.getLine(0)?.translateToString(true),
          cursor: value.runtime.lastOutputSequence?.toString(),
        };
      } finally { cache.retainTerminalSession(session, value); }
    }, identity);
    await leaveSession();
    expect(await cachedScreen()).toEqual({ firstLine: "After clear", cursor: "3" });
    await page.evaluate(() => { window.__terminalReplay.outputs.push("47;49m restored\x1b[0m"); });
    await page.evaluate(([workspace, session]) => {
      window.location.hash = `#/workspaces/${workspace}/sessions/${session}`;
    }, [FIXTURE_IDS.workspace, FIXTURE_IDS.workspaceCodex]);
    await expect.poll(() => page!.evaluate(() => window.__terminalReplay.delivered)).toBe(4);
    await page.screenshot({ path: "/tmp/treefold-terminal-replay.png" });
    await leaveSession();
    expect(await cachedScreen()).toEqual({ firstLine: "After clear restored", cursor: "4" });
    const cursors = await page.evaluate(() => window.__terminalReplay.cursors);
    expect(cursors[0]).toBe("0");
    expect(cursors.at(-1)).toBe("3");

    // Exercise the cold reconstruction path used after cache eviction.
    await page.evaluate(async (session) => {
      const cache = await import("/src/features/terminal/sessionCache.ts");
      cache.discardTerminalSession(session.id);
      window.__terminalReplay.cursors = [];
      window.location.hash = `#/workspaces/${session.workspace_id}/sessions/${session.id}`;
    }, identity);
    await expect.poll(() => page!.evaluate(() => window.__terminalReplay.cursors)).toEqual(["0"]);
    await leaveSession();
    expect(await cachedScreen()).toEqual({ firstLine: "After clear restored", cursor: "4" });
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-terminal-replay-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("a stopped Codex with a pending identity can retry Restart", async () => {
  const harness = await startUiHarness();
  harness.setProcessState(FIXTURE_IDS.workspaceCodex, "exited");
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "codex-restart" });
    await page.route("**/api/**", async route => {
      if (route.request().method() !== "GET" || new URL(route.request().url()).pathname === "/api/events") return route.continue();
      const response = await route.fetch();
      if (!response.headers()["content-type"]?.includes("application/json")) return route.fulfill({ response });
      const body = await response.json();
      const visit = (value: unknown): void => {
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        if (record.id === FIXTURE_IDS.workspaceCodex) {
          record.codex_session_id = null;
          if (record.status === "exited") record.status = "stopped";
        }
        Object.values(record).forEach(visit);
      };
      visit(body);
      await route.fulfill({ response, json: body });
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}/sessions/${FIXTURE_IDS.workspaceCodex}`);
    const restart = page.getByRole("button", { name: "Restart", exact: true });
    await expect(restart).toBeEnabled();
    const request = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith(`/api/sessions/${FIXTURE_IDS.workspaceCodex}/restart`));
    await restart.click();
    await request;
    await expect(page.getByTestId("session-workspace").getByText("running", { exact: true })).toBeVisible();
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

for (const kind of ["plain", "osc8"] as const) {
  test(`TTY ${kind} URL opens externally on click without confirmation`, async () => {
    const harness = await startUiHarness();
    harness.setProcessState(FIXTURE_IDS.workspaceShell, "running");
    let page: Page | undefined;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "terminal-links" });
      await page.addInitScript((kind) => {
        const opened: string[] = [];
        Object.defineProperty(window, "__openedUrls", { value: opened });
        window.open = ((url: string | URL | undefined) => {
          opened.push(String(url));
          return null;
        }) as typeof window.open;
        Object.defineProperty(window, "__linkOutputSent", { value: { current: false } });
        class LinkSocket {
          static OPEN = 1;
          readyState = 0;
          bufferedAmount = 0;
          binaryType = "arraybuffer";
          onopen: ((event: Event) => void) | null = null;
          onmessage: ((event: MessageEvent) => void) | null = null;
          onclose: ((event: CloseEvent) => void) | null = null;
          constructor(_url: string | URL) {
            setTimeout(() => {
              this.readyState = 1;
              this.onopen?.(new Event("open"));
              this.message({ type: "output_cursor", sequence: "0" });
              this.message({ type: "ownership_state", state: "controller" });
            }, 0);
          }
          message(value: unknown) {
            this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(value) }));
          }
          send(wire: string) {
            if (JSON.parse(wire).type !== "terminal_ready") return;
            const url = "https://example.test/verify?flow_id=abc&user_code=123";
            const output = kind === "osc8" ? `\x1b]8;;${url}\x1b\\Authorize\x1b]8;;\x1b\\` : url;
            const text = new TextEncoder().encode(`${output}\r\n`);
            const frame = new Uint8Array(text.length + 8);
            new DataView(frame.buffer).setBigUint64(0, 1n);
            frame.set(text, 8);
            this.onmessage?.(new MessageEvent("message", { data: frame.buffer }));
            (window as typeof window & { __linkOutputSent: { current: boolean } }).__linkOutputSent.current = true;
          }
          close() {
            this.readyState = 3;
            this.onclose?.(new CloseEvent("close"));
          }
        }
        window.WebSocket = LinkSocket as unknown as typeof WebSocket;
      }, kind);
      const dialogs: string[] = [];
      page.on("dialog", async dialog => {
        dialogs.push(dialog.message());
        await dialog.dismiss();
      });
      await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}/sessions/${FIXTURE_IDS.workspaceShell}`);
      await expect.poll(() => page!.evaluate(() => (window as typeof window & { __linkOutputSent: { current: boolean } }).__linkOutputSent.current)).toBe(true);
      const screen = page.locator(".xterm-screen");
      const box = await screen.boundingBox();
      if (!box) throw new Error("terminal screen not mounted");
      const point = { x: box.x + 20, y: box.y + 10 };
      await page.mouse.move(point.x, point.y);
      await page.waitForTimeout(200);
      await page.mouse.click(point.x, point.y);
      await expect.poll(() => page!.evaluate(() => (window as typeof window & { __openedUrls: string[] }).__openedUrls)).toEqual(["https://example.test/verify?flow_id=abc&user_code=123"]);
      await page.mouse.move(point.x + 1, point.y);
      await page.keyboard.down("Control");
      await page.mouse.click(point.x + 1, point.y);
      await page.keyboard.up("Control");
      await expect.poll(() => page!.evaluate(() => (window as typeof window & { __openedUrls: string[] }).__openedUrls)).toEqual(Array(2).fill("https://example.test/verify?flow_id=abc&user_code=123"));
      await page.keyboard.down("Meta");
      await page.mouse.click(point.x + 1, point.y);
      await page.keyboard.up("Meta");
      await expect.poll(() => page!.evaluate(() => (window as typeof window & { __openedUrls: string[] }).__openedUrls)).toEqual(Array(3).fill("https://example.test/verify?flow_id=abc&user_code=123"));
      expect(dialogs).toEqual([]);
      harness.assertNoUnexpectedRequests();
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

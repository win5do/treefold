import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { createUiSession, closeUiSession } from "./harness/session.ts";

test("macOS terminal sends committed punctuation once and preserves IME and control keys", async () => {
  test.skip(process.platform !== "darwin", "macOS input-method event sequences");
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "terminal-ime" });
    await page.goto(harness.baseUrl);
    const results = await page.evaluate(async ({ xtermPath, workaroundPath }) => {
      const { Terminal } = await import(xtermPath);
      const { setupXtermIme229Workaround } = await import(workaroundPath);
      const host = document.createElement("div");
      document.body.append(host);
      const terminal = new Terminal();
      terminal.open(host);
      const dispose = setupXtermIme229Workaround({ terminal, host });
      const textarea: HTMLTextAreaElement = terminal.textarea;
      const sent: string[] = [];
      const subscription = terminal.onData((data: string) => sent.push(data));
      const results: Record<string, string[]> = {};
      const key = (type: string, value: string, keyCode: number, options: KeyboardEventInit = {}) =>
        textarea.dispatchEvent(new KeyboardEvent(type, { key: value, keyCode, bubbles: true, cancelable: true, composed: true, ...options }));
      const insert = (data: string) => {
        if (!textarea.dispatchEvent(new InputEvent("beforeinput", { data, inputType: "insertText", bubbles: true, composed: true, cancelable: true }))) return;
        textarea.value += data;
        textarea.dispatchEvent(new InputEvent("input", { data, inputType: "insertText", bubbles: true, composed: true }));
      };
      const type = (physical: string, keyCode: number, committed: string, shiftKey = false) => {
        if (shiftKey) key("keydown", "Shift", 16, { shiftKey: true });
        // Replay the native trace: preventDefault at keydown suppresses the IME commit.
        if (key("keydown", physical, keyCode, { shiftKey })) {
          if (committed !== physical || key("keypress", physical, keyCode, { charCode: physical.charCodeAt(0), shiftKey })) insert(committed);
        }
        key("keyup", physical, keyCode, { shiftKey });
        if (shiftKey) key("keyup", "Shift", 16);
      };
      const save = (name: string) => { results[name] = sent.splice(0); };
      try {
        for (const [physical, code, committed, shifted] of [
          [".", 190, "。", false], [",", 188, "，", false], [";", 186, "；", false],
          [":", 186, "：", true], ["?", 191, "？", true], ["!", 49, "！", true],
          ['"', 222, "“", true], ['"', 222, "”", true],
        ] as const) type(physical, code, committed, shifted);
        save("chinese");
        // WeType may commit paired quotes, then move the terminal cursor left.
        type("'", 222, "‘’");
        key("keydown", "ArrowLeft", 37);
        key("keyup", "ArrowLeft", 37);
        save("pairedQuotes");
        for (const value of [".", ",", ";", "/", "[", "]", "=", "-"]) type(value, 190, value);
        type(":", 186, ":", true);
        save("english");
        // The older 229 regression: Shift reaches xterm before an early input event.
        key("keydown", "Shift", 16, { shiftKey: true });
        insert("x");
        key("keydown", "x", 229);
        key("keyup", "x", 229);
        key("keyup", "Shift", 16);
        save("early229");
        key("keydown", "Shift", 16, { shiftKey: true });
        insert(".");
        key("keydown", ".", 229);
        key("keyup", ".", 229);
        key("keyup", "Shift", 16);
        save("early229Punctuation");
        type("y", 229, "y");
        save("late229");
        // Composition is still owned by xterm and must not emit preedit text.
        key("keydown", "n", 229);
        textarea.dispatchEvent(new CompositionEvent("compositionstart", { data: "", bubbles: true }));
        textarea.dispatchEvent(new CompositionEvent("compositionupdate", { data: "你好", bubbles: true }));
        textarea.value = "你好";
        textarea.dispatchEvent(new InputEvent("input", { data: "你好", inputType: "insertCompositionText", isComposing: true, bubbles: true, composed: true }));
        textarea.dispatchEvent(new CompositionEvent("compositionend", { data: "你好", bubbles: true }));
        key("keyup", " ", 229);
        await new Promise(resolve => setTimeout(resolve, 20));
        type(".", 190, "。");
        save("composition");
        key("keydown", "c", 67, { ctrlKey: true });
        key("keyup", "c", 67, { ctrlKey: true });
        key("keydown", "Enter", 13);
        key("keyup", "Enter", 13);
        save("controls");
        terminal.options.disableStdin = true;
        type(".", 190, "。");
        save("readonly");
        return results;
      } finally { subscription.dispose(); dispose(); terminal.dispose(); host.remove(); }
    }, { xtermPath: `/@fs/${process.cwd()}/node_modules/@xterm/xterm/lib/xterm.mjs`, workaroundPath: "/src/features/terminal/xtermIme229Workaround.ts" });
    expect(results).toEqual({
      chinese: ["。", "，", "；", "：", "？", "！", "“", "”"],
      pairedQuotes: ["‘’", "\x1b[D"],
      english: [".", ",", ";", "/", "[", "]", "=", "-", ":"],
      early229: ["x"], early229Punctuation: ["."], late229: ["y"], composition: ["你好", "。"],
      controls: ["\x03", "\r"], readonly: [],
    });
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

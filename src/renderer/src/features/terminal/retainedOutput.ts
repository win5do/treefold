import { Terminal } from "@xterm/xterm";
import { apiUrl } from "@/api/client";

// Parse the retained TTY stream with xterm, including split UTF-8/ANSI, screen
// repaints, and OSC titles. Stripping escapes per record corrupts these streams.
export async function readRetainedOutput(id: string, signal: AbortSignal): Promise<{ text: string; gap: boolean }> {
  const response = await fetch(apiUrl(`/api/sessions/${id}/logs?after=0&follow=false`), { signal });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const terminal = new Terminal({ cols: 120, rows: 40, scrollback: 200, convertEol: true });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let execution: number | undefined;
  let gap = false;
  const flush = () => new Promise<void>(resolve => terminal.write("", resolve));
  const consume = async (line: string) => {
    signal.throwIfAborted();
    if (!line) return;
    const record = JSON.parse(line) as {
      type?: string;
      execution?: number;
      data?: { encoding: string; text?: string; base64?: string };
    };
    if (record.type === "gap") {
      gap = true;
      await flush();
      terminal.reset();
      return;
    }
    if (!record.data) return;
    if (execution !== undefined && execution !== record.execution) {
      await flush();
      terminal.reset();
    }
    execution = record.execution;
    const data = record.data.encoding === "utf8"
      ? new TextEncoder().encode(record.data.text ?? "")
      : record.data.encoding === "base64" && record.data.base64
        ? Uint8Array.from(atob(record.data.base64), char => char.charCodeAt(0))
        : new Uint8Array();
    terminal.write(data);
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        await consume(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
      // Drain each network chunk rather than scheduling a render per record.
      await flush();
      if (done) break;
    }
    await consume(pending);
    await flush();
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let index = 0; index < buffer.length; index += 1) {
      const line = buffer.getLine(index);
      const text = line?.translateToString(true) ?? "";
      if (line?.isWrapped && lines.length) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    return { text: lines.join("\n").trimEnd().slice(-16_000), gap };
  } finally {
    await reader.cancel().catch(() => {});
    terminal.dispose();
  }
}

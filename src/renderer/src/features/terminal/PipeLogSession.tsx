import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/api/client";
import type { Session } from "@/domain/types";

type LogRecord = {
  type?: string;
  oldest_available?: number;
  data?: { encoding: string; text?: string; base64?: string };
};

const maxVisibleCharacters = 1_000_000;
const ansiEscape = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;

function decodeRecord(line: string, cursor: { value: string }, formatGap: (sequence: number | undefined) => string): string {
  const record = JSON.parse(line) as LogRecord;
  if (record.type === "gap") return `\n[${formatGap(record.oldest_available)}]\n`;
  // Preserve the decimal cursor without rounding through JavaScript's Number type.
  const sequence = /"sequence"\s*:\s*(\d+)/.exec(line)?.[1];
  if (sequence && BigInt(sequence) <= BigInt(cursor.value)) return "";
  if (sequence) cursor.value = sequence;
  if (!record.data) return "";
  const output = record.data.encoding === "utf8"
    ? record.data.text ?? ""
    : record.data.encoding === "base64" && record.data.base64
      ? new TextDecoder().decode(Uint8Array.from(atob(record.data.base64), (char) => char.charCodeAt(0)))
      : "";
  return output.replace(ansiEscape, "");
}

export function PipeLogSession({ session, busy, onRestart }: { session: Session; busy: boolean; onRestart: () => void }) {
  const { t } = useTranslation();
  const [output, setOutput] = useState("");
  const logRef = useRef<HTMLPreElement>(null);
  const followBottom = useRef(true);
  useEffect(() => {
    const element = logRef.current;
    if (element && followBottom.current) element.scrollTop = element.scrollHeight;
  }, [output]);

  useEffect(() => {
    const cursor = { value: "0" };
    const controller = new AbortController();
    let reconnectTimer = 0;
    let failures = 0;
    const follow = session.status === "running";
    const append = (text: string) => {
      if (!text) return;
      setOutput((previous) => (previous + text).slice(-maxVisibleCharacters));
    };
    const connect = async () => {
      try {
        const query = new URLSearchParams({ after: cursor.value, follow: String(follow) });
        const response = await fetch(apiUrl(`/api/sessions/${session.id}/logs?${query}`), { signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        failures = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, end);
            pending = pending.slice(end + 1);
            if (line) append(decodeRecord(line, cursor, (sequence) => t("terminalUi.logHistoryGap", { sequence })));
          }
        }
        pending += decoder.decode();
        if (pending) append(decodeRecord(pending, cursor, (sequence) => t("terminalUi.logHistoryGap", { sequence })));
      } catch (cause) {
        if (controller.signal.aborted) return;
        append(`\n[${t("terminalUi.logStreamUnavailable", { reason: cause instanceof Error ? cause.message : "unknown error" })}]\n`);
        failures += 1;
      }
      if (follow && !controller.signal.aborted) {
        reconnectTimer = window.setTimeout(() => void connect(), Math.min(4000, 250 * 2 ** failures));
      }
    };
    void connect();
    return () => {
      controller.abort();
      window.clearTimeout(reconnectTimer);
    };
  }, [session.id, session.status, session.launch_started_at, t]);

  return <div data-testid="session-pipe-logs" className="flex min-h-0 flex-1 flex-col">
    <div className="flex items-center justify-between border-b border-terminal-accent px-4 py-2 text-xs text-terminal-muted">
      <span>{session.argv.join(" ")} · {t(`states.${session.status}`, { defaultValue: session.status })}</span>
      {session.status !== "running" && <Button size="sm" variant="terminal" disabled={busy} onClick={onRestart}>
        <RotateCcw data-icon="inline-start" />{t("terminalUi.resume")}
      </Button>}
    </div>
    <pre ref={logRef} role="log" aria-label={t("terminalUi.processOutput")} onScroll={(event) => {
      const element = event.currentTarget;
      followBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    }} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[13px] leading-5 text-terminal-foreground">{output}</pre>
  </div>;
}

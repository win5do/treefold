import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Session } from "@/domain/types";
import { readRetainedOutput } from "./retainedOutput";

export function StoppedSessionOutput({ session }: { session: Session }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<{ text: string; gap: boolean }>();
  const [error, setError] = useState<string>();
  const outputRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setResult(undefined);
    setError(undefined);
    void readRetainedOutput(session.id, controller.signal).then(value => {
      if (!controller.signal.aborted) setResult(value);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => controller.abort();
  }, [session.id, session.launch_started_at, session.status]);
  useEffect(() => {
    const element = outputRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [result]);
  return <div className="flex min-w-0 flex-col gap-2 text-xs">
    <p>{t("terminalUi.recentOutput")}</p>
    {error ? <p role="status">{t("terminalUi.logStreamUnavailable", { reason: error })}</p>
      : !result ? <p role="status">{t("terminalUi.loadingOutput")}</p>
        : !result.text ? <p>{t("terminalUi.noRetainedOutput")}</p>
          : <pre ref={outputRef} tabIndex={0} aria-label={t("terminalUi.recentOutput")} className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-terminal-accent p-3 font-mono text-terminal-foreground [scrollbar-gutter:stable]">{result.text}</pre>}
    {result?.gap && <p>{t("terminalUi.retainedOutputGap")}</p>}
  </div>;
}

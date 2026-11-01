import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { settingsQuery } from "@/features/app/queries";
import {
  DEFAULT_AI_COMMIT,
  openAiCommitSettings,
  runGeneration,
  type GenerationInput,
} from "./api";

type Props = {
  id?: string;
  label: string;
  value: string;
  fallback: string;
  onChange: (message: string) => void;
  input: GenerationInput | null;
  disabled?: boolean;
  invalid?: boolean;
  showSettings?: boolean;
  onBusyChange?: (busy: boolean) => void;
};

/** One draft owner per repository/editor. Only an explicit refresh replaces a
 * draft; automatic generation runs once after a usable context becomes available. */
export function AiCommitField(props: Props) {
  const { t } = useTranslation();
  const settings = useQuery(settingsQuery());
  const config = settings.data?.ai_commit ?? DEFAULT_AI_COMMIT;
  const [status, setStatus] = useState<"idle" | "queued" | "running">("idle");
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const active = useRef<AbortController | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const contextKey = JSON.stringify(props.input);
  const previousKey = useRef(contextKey);
  const attempted = useRef(false);
  const edited = useRef(false);
  const busy = status !== "idle";
  const cancel = () => {
    active.current?.abort();
    active.current = null;
    setStatus("idle");
  };
  useEffect(() => {
    if (previousKey.current === contextKey) return;
    previousKey.current = contextKey;
    cancel();
    setStale(attempted.current || edited.current);
  }, [contextKey]);
  useEffect(() => {
    props.onBusyChange?.(busy);
    return () => props.onBusyChange?.(false);
  }, [busy, props.onBusyChange]);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  useEffect(() => {
    if (props.disabled) cancel();
  }, [props.disabled]);

  const generate = async () => {
    if (!config.command.trim()) {
      openAiCommitSettings();
      return;
    }
    const initial = latest.current;
    if (!initial.input || initial.disabled || active.current) return;
    attempted.current = true;
    const controller = new AbortController();
    active.current = controller;
    const key = JSON.stringify(initial.input);
    const owns = () =>
      active.current === controller &&
      !controller.signal.aborted &&
      JSON.stringify(latest.current.input) === key;
    setStatus("queued");
    setError("");
    setStale(false);
    try {
      const job = await runGeneration(
        initial.input,
        controller.signal,
        (state) => {
          if (owns() && (state === "queued" || state === "running"))
            setStatus(state);
        },
      );
      if (!owns()) return;
      if (job.status === "succeeded" && job.message) {
        if (latest.current.value === initial.value)
          initial.onChange(job.message);
      } else if (job.status !== "canceled") {
        setError(
          t(
            job.status === "timed_out" ? "aiCommit.timeout" : "aiCommit.failed",
            { detail: job.error ?? "" },
          ),
        );
        if (!latest.current.value.trim()) initial.onChange(initial.fallback);
      }
    } catch (cause) {
      if (owns()) {
        setError(
          t("aiCommit.failed", {
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
        );
        if (!latest.current.value.trim()) initial.onChange(initial.fallback);
      }
    } finally {
      if (owns()) {
        active.current = null;
        setStatus("idle");
      }
    }
  };
  useEffect(() => {
    if (
      !attempted.current &&
      !edited.current &&
      config.automatic &&
      config.command.trim() &&
      props.input &&
      !props.disabled &&
      (!props.value.trim() || props.value === props.fallback)
    )
      void generate();
  }, [
    config.automatic,
    config.command,
    contextKey,
    props.disabled,
    props.value,
  ]);
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={
            props.disabled || busy || (!!config.command.trim() && !props.input)
          }
          onClick={() => void generate()}
        >
          {busy ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <Sparkles data-icon="inline-start" />
          )}
          {t(
            status === "queued"
              ? "aiCommit.queued"
              : status === "running"
                ? "aiCommit.generating"
                : "aiCommit.title",
          )}
        </Button>
        {busy && (
          <Button type="button" variant="ghost" size="sm" onClick={cancel}>
            {t("aiCommit.cancel")}
          </Button>
        )}
        {props.showSettings !== false && (
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={openAiCommitSettings}
          >
            {t("aiCommit.settings")}
          </Button>
        )}
      </div>
      <Textarea
        id={props.id}
        aria-label={props.label}
        aria-invalid={props.invalid}
        placeholder={props.label}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => {
          edited.current = true;
          cancel();
          setError("");
          props.onChange(event.target.value);
        }}
        className="max-h-48"
      />
      {stale && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("aiCommit.stale")}
        </p>
      )}
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

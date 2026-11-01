import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useAgentCatalog } from "@/features/agents/useAgentCatalog";
import {
  presetsQuery,
  runGeneration,
  type AiCommitSettings,
  type Job,
} from "@/features/ai-commit/api";

export function SettingsAiCommit({
  value,
  onChange,
  disabled,
}: {
  value: AiCommitSettings;
  onChange: (value: AiCommitSettings) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const catalog = useAgentCatalog();
  const presets = useQuery(presetsQuery());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const latestCommand = useRef(value.command);
  latestCommand.current = value.command;
  const cancel = () => {
    active.current?.abort();
    active.current = null;
    setBusy(false);
  };
  useEffect(() => {
    cancel();
    setResult(null);
    setError("");
  }, [value.command]);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  const available = catalog.error
    ? []
    : catalog.agents
        .filter((agent) => agent.available)
        .flatMap((agent) => {
          const preset = presets.data?.find(
            (preset) => preset.kind === agent.kind,
          );
          return preset ? [{ ...preset, name: agent.name }] : [];
        });
  const selected =
    available.find((preset) => preset.command === value.command)?.kind ?? "";
  const test = async () => {
    cancel();
    const controller = new AbortController();
    active.current = controller;
    const owns = () =>
      active.current === controller && !controller.signal.aborted && latestCommand.current === value.command;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const job = await runGeneration(
        { command: value.command },
        controller.signal,
        () => undefined,
      );
      if (owns()) {
        setResult(job);
        if (job.status !== "succeeded" && job.status !== "canceled")
          setError(
            t(
              job.status === "timed_out"
                ? "aiCommit.testTimeout"
                : "aiCommit.testFailed",
              { detail: job.error ?? "" },
            ),
          );
      }
    } catch (cause) {
      if (owns()) setError(t("aiCommit.testFailed", { detail: String(cause) }));
    } finally {
      if (owns()) {
        active.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <section
      id="ai-commit-settings"
      aria-labelledby="ai-commit-settings-title"
      className="flex flex-col gap-3"
    >
      <h3 id="ai-commit-settings-title" className="text-sm font-medium">
        {t("aiCommit.title")}
      </h3>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="ai-commit-preset">
            {t("aiCommit.preset")}
          </FieldLabel>
          <NativeSelect
            id="ai-commit-preset"
            value={selected}
            disabled={disabled || !available.length}
            onChange={(event) => {
              const preset = available.find(
                (preset) => preset.kind === event.target.value,
              );
              if (preset) onChange({ ...value, command: preset.command });
            }}
          >
            <NativeSelectOption value="">
              {t(value.command ? "aiCommit.custom" : "aiCommit.choosePreset")}
            </NativeSelectOption>
            {available.map((preset) => (
              <NativeSelectOption key={preset.kind} value={preset.kind}>
                {preset.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription>{t("aiCommit.presetHint")}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="ai-commit-command">
            {t("aiCommit.command")}
          </FieldLabel>
          <Textarea
            id="ai-commit-command"
            value={value.command}
            rows={3}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, command: event.target.value })
            }
          />
          <FieldDescription>{t("aiCommit.commandHint")}</FieldDescription>
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={disabled || busy || !value.command.trim()}
            onClick={() => void test()}
          >
            {busy && (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            )}
            {t("aiCommit.test")}
          </Button>
          {busy && (
            <Button variant="ghost" onClick={cancel}>
              {t("aiCommit.cancel")}
            </Button>
          )}
          {result?.status === "succeeded" && (
            <span
              role="status"
              className="flex items-center gap-1 text-sm text-success"
            >
              <Check className="size-4" />
              {t("aiCommit.passed", {
                seconds: (result.elapsed_ms / 1000).toFixed(1),
              })}
            </span>
          )}
        </div>
        {result?.message && (
          <pre
            aria-label={t("aiCommit.testOutput")}
            className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm"
          >
            {result.message}
          </pre>
        )}
        {error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {error}
          </p>
        )}
        <Field orientation="horizontal">
          <Switch
            id="ai-commit-automatic"
            checked={value.automatic}
            disabled={disabled}
            onCheckedChange={(automatic) => onChange({ ...value, automatic })}
          />
          <FieldLabel htmlFor="ai-commit-automatic">
            {t("aiCommit.automatic")}
          </FieldLabel>
        </Field>
        <FieldDescription>{t("aiCommit.automaticHint")}</FieldDescription>
      </FieldGroup>
    </section>
  );
}

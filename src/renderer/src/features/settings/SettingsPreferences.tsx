import type { SettingsFormPatch } from "./useSettingsSave";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect as Select } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type {
  AppSettings,
  SystemStatus,
  ThemePreference,
} from "@/domain/types";
import type { LanguagePreference } from "@/i18n";
import { toast } from "@/lib/toast";

type SettingsSaveFeedback =
  { kind: "idle" | "saving" };

export function SettingsPreferences({
  open,
  system,
  settings,
  busy,
  onSave,
}: {
  open: boolean;
  system: SystemStatus | null;
  settings: AppSettings | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (update: SettingsFormPatch) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const { t } = useTranslation();
  const [extraArgs, setExtraArgs] = useState<string[]>([]);
  const [language, setLanguage] = useState<LanguagePreference>("system");
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [keepDaemonRunningOnExit, setKeepDaemonRunningOnExit] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<SettingsSaveFeedback>({
    kind: "idle",
  });
  const configuredArgsKey = JSON.stringify(
    settings?.agents.codex.extra_args ?? [],
  );
  useEffect(() => {
    if (!open) return;
    setExtraArgs([...(settings?.agents.codex.extra_args ?? [])]);
    setLanguage(settings?.language ?? "system");
    setTheme(settings?.theme ?? "system");
    setKeepDaemonRunningOnExit(
      settings?.amux.keep_daemon_running_on_exit ?? false,
    );
  }, [
    open,
    configuredArgsKey,
    settings?.language,
    settings?.theme,
    settings?.amux.keep_daemon_running_on_exit,
  ]);
  useEffect(() => {
    if (open) setSaveFeedback({ kind: "idle" });
  }, [open]);
  const clearSaveFeedback = () => setSaveFeedback({ kind: "idle" });
  const updateArgument = (index: number, value: string) => {
    clearSaveFeedback();
    setExtraArgs((current) =>
      current.map((argument, itemIndex) =>
        itemIndex === index ? value : argument,
      ),
    );
  };
  const removeArgument = (index: number) => {
    clearSaveFeedback();
    setExtraArgs((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  };
  const moveArgument = (index: number, offset: number) => {
    clearSaveFeedback();
    setExtraArgs((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const hasEmptyArgument = extraArgs.some((argument) => argument.length === 0);
  const saving = saveFeedback.kind === "saving";
  const handleSave = async () => {
    setSaveFeedback({ kind: "saving" });
    const result = await onSave({
      ...(language !== settings?.language ? { language } : {}),
      ...(theme !== settings?.theme ? { theme } : {}),
      ...(JSON.stringify(extraArgs) !== configuredArgsKey ? { extraArgs } : {}),
      ...(keepDaemonRunningOnExit !== settings?.amux.keep_daemon_running_on_exit ? { keepDaemonRunningOnExit } : {}),
    });
    setSaveFeedback({ kind: "idle" });
    if (result.ok) toast.success(t("settings.saved"));
    else toast.error(t("settings.saveFailed", { message: result.error }));
  };
  const runtimeItems = [
    { key: "treefold-home", label: "Treefold Home", value: system?.treefold_home ?? "—" },
    { key: "platform", label: "Platform", value: system?.platform ?? "—" },
    {
      key: "codex",
      label: "Codex",
      value: system?.codex_available
        ? system.codex_version ?? "Codex"
        : t("common.unavailable"),
    },
  ];
  const copyRuntime = async () => {
    const text = runtimeItems.map(({ label, value }) => `${label}: ${value}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("settings.runtime.copied"));
    } catch (cause) {
      console.error("Could not copy runtime information", cause);
      toast.error(t("settings.runtime.copyFailed"));
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FieldGroup className="gap-0">
            <Field orientation="responsive" className="px-6 py-5">
              <FieldContent>
                <FieldLabel htmlFor="settings-language">
                  {t("settings.language.title")}
                </FieldLabel>
                <FieldDescription>
                  {t("settings.language.description")}
                </FieldDescription>
              </FieldContent>
              <Select
                data-testid="settings-language"
                id="settings-language"
                className="min-w-44"
                value={language}
                onChange={(event) => {
                  clearSaveFeedback();
                  setLanguage(event.target.value as LanguagePreference);
                }}
              >
                <option value="system">{t("settings.language.system")}</option>
                <option value="en-US">{t("settings.language.english")}</option>
                <option value="zh-CN">
                  {t("settings.language.simplifiedChinese")}
                </option>
              </Select>
            </Field>
            <Separator />
            <Field orientation="responsive" className="px-6 py-5">
              <FieldContent>
                <FieldLabel htmlFor="settings-theme">
                  {t("settings.theme.title")}
                </FieldLabel>
                <FieldDescription>
                  {t("settings.theme.description")}
                </FieldDescription>
              </FieldContent>
              <Select
                data-testid="settings-theme"
                id="settings-theme"
                className="min-w-44"
                value={theme}
                onChange={(event) => {
                  clearSaveFeedback();
                  setTheme(event.target.value as ThemePreference);
                }}
              >
                <option value="system">{t("settings.theme.system")}</option>
                <option value="light">{t("settings.theme.light")}</option>
                <option value="dark">{t("settings.theme.dark")}</option>
              </Select>
            </Field>
            <Separator />
            <Field orientation="responsive" className="px-6 py-5">
              <FieldContent>
                <FieldLabel htmlFor="settings-keep-amux">
                  {t("settings.amux.title")}
                </FieldLabel>
                <FieldDescription>
                  {t("settings.amux.description")}
                </FieldDescription>
              </FieldContent>
              <Switch
                id="settings-keep-amux"
                data-testid="settings-keep-amux"
                checked={keepDaemonRunningOnExit}
                onCheckedChange={(checked) => {
                  clearSaveFeedback();
                  setKeepDaemonRunningOnExit(checked);
                }}
              />
            </Field>
            <Separator />
            <Field
              orientation="responsive"
              data-invalid={hasEmptyArgument || undefined}
              className="px-6 py-5"
            >
              <FieldContent>
                <FieldTitle>{t("settings.codexArguments.title")}</FieldTitle>
                <FieldDescription>
                  {t("settings.codexArguments.description")}
                </FieldDescription>
              </FieldContent>
              <div className="flex w-full flex-col gap-3 @md/field-group:max-w-sm">
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      clearSaveFeedback();
                      setExtraArgs((current) => [...current, ""]);
                    }}
                  >
                    <Plus data-icon="inline-start" />
                    {t("settings.codexArguments.add")}
                  </Button>
                </div>
                <div
                  data-testid="codex-extra-args"
                  className="flex flex-col gap-2"
                >
                  {extraArgs.length === 0 ? (
                    <p className="rounded-md bg-muted px-3 py-4 text-center text-muted-foreground">
                      {t("settings.codexArguments.empty")}
                    </p>
                  ) : (
                    extraArgs.map((argument, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="w-5 shrink-0 text-right font-mono text-muted-foreground">
                          {index + 1}
                        </span>
                        <Input
                          className="min-w-0 flex-1 font-mono"
                          aria-invalid={argument.length === 0 || undefined}
                          aria-label={t("settings.codexArguments.input", {
                            index: index + 1,
                          })}
                          value={argument}
                          placeholder="--argument"
                          onChange={(event) =>
                            updateArgument(index, event.target.value)
                          }
                        />
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("settings.codexArguments.moveUp", {
                            index: index + 1,
                          })}
                          disabled={index === 0}
                          onClick={() => moveArgument(index, -1)}
                        >
                          <ChevronUp data-icon="inline-start" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("settings.codexArguments.moveDown", {
                            index: index + 1,
                          })}
                          disabled={index === extraArgs.length - 1}
                          onClick={() => moveArgument(index, 1)}
                        >
                          <ChevronDown data-icon="inline-start" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("settings.codexArguments.remove", {
                            index: index + 1,
                          })}
                          onClick={() => removeArgument(index)}
                        >
                          <Trash2 data-icon="inline-start" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
                {hasEmptyArgument && (
                  <FieldError>
                    {t("settings.codexArguments.validation")}
                  </FieldError>
                )}
              </div>
            </Field>
            <Separator />
            <Field orientation="responsive" className="px-6 py-5">
              <FieldContent>
                <FieldTitle>{t("settings.runtime.title")}</FieldTitle>
                <FieldDescription>
                  {t("settings.runtime.description")}
                </FieldDescription>
                <Button
                  className="self-start"
                  variant="outline"
                  disabled={!system}
                  onClick={() => void copyRuntime()}
                >
                  <Copy data-icon="inline-start" />
                  {t("settings.runtime.copy")}
                </Button>
              </FieldContent>
              <dl className="w-full divide-y overflow-hidden rounded-md border @md/field-group:max-w-sm">
                {runtimeItems.map((item) => (
                  <div
                    key={item.key}
                    data-testid={`settings-runtime-${item.key}`}
                    className="grid min-h-10 grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 px-3"
                  >
                    <dt className="text-sm text-muted-foreground">{item.label}</dt>
                    <dd className="min-w-0 truncate font-mono text-xs" title={item.value}>
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </Field>
          </FieldGroup>
        </div>
        <Separator />
        <div className="flex min-h-16 shrink-0 items-center justify-end gap-3 px-6 py-3">
          <Button variant="ghost" disabled={busy || saving} onClick={async () => {
            const result = await onSave({ reset: ["language", "theme", "agents.codex.extra_args", "amux.keep_daemon_running_on_exit"] });
            if (!result.ok) toast.error(result.error);
          }}>恢复默认设置</Button>
          <Button
            data-testid="settings-save"
            aria-busy={saving}
            disabled={busy || hasEmptyArgument}
            onClick={() => void handleSave()}
          >
            {saving && (
              <Spinner
                data-testid="settings-save-spinner"
                data-icon="inline-start"
              />
            )}
            {t(saving ? "settings.saving" : "common.save")}
          </Button>
        </div>
    </div>
  );
}

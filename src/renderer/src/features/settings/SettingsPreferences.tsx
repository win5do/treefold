import type { SettingsFormPatch } from "./useSettingsSave";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
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
import { appVersionQuery } from "@/features/app/queries";

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
  const appVersion = useQuery(appVersionQuery());
  const [language, setLanguage] = useState<LanguagePreference>("system");
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [keepDaemonRunningOnExit, setKeepDaemonRunningOnExit] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<SettingsSaveFeedback>({
    kind: "idle",
  });
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    if (!open) setResetOpen(false);
  }, [open]);
  const handleReset = async () => {
    if (busy || resetting) return;
    setResetting(true);
    try {
      const result = await onSave({ reset: ["language", "theme", "amux.keep_daemon_running_on_exit"] });
      if (result.ok) {
        setLanguage("system");
        setTheme("system");
        setKeepDaemonRunningOnExit(false);
        setResetOpen(false);
        toast.success(t("settings.saved"));
      } else toast.error(t("settings.saveFailed", { message: result.error }));
    } finally {
      setResetting(false);
    }
  };
  useEffect(() => {
    if (!open) return;
    setLanguage(settings?.language ?? "system");
    setTheme(settings?.theme ?? "system");
    setKeepDaemonRunningOnExit(
      settings?.amux.keep_daemon_running_on_exit ?? false,
    );
  }, [
    open,
    settings?.language,
    settings?.theme,
    settings?.amux.keep_daemon_running_on_exit,
  ]);
  useEffect(() => {
    if (open) setSaveFeedback({ kind: "idle" });
  }, [open]);
  const clearSaveFeedback = () => setSaveFeedback({ kind: "idle" });
  const saving = saveFeedback.kind === "saving";
  const handleSave = async () => {
    setSaveFeedback({ kind: "saving" });
    const result = await onSave({
      ...(language !== settings?.language ? { language } : {}),
      ...(theme !== settings?.theme ? { theme } : {}),
      ...(keepDaemonRunningOnExit !== settings?.amux.keep_daemon_running_on_exit ? { keepDaemonRunningOnExit } : {}),
    });
    setSaveFeedback({ kind: "idle" });
    if (result.ok) toast.success(t("settings.saved"));
    else toast.error(t("settings.saveFailed", { message: result.error }));
  };
  const runtimeItems = [
    { key: "app-version", label: t("settings.runtime.appVersion"), value: appVersion.data ?? "—" },
    { key: "treefold-home", label: t("settingsUi.treefoldHome"), value: system?.treefold_home ?? "—" },
    { key: "platform", label: t("settingsUi.platform"), value: system?.platform ?? "—" },
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
            <Field orientation="responsive" className="px-6 py-5">
              <FieldContent>
                <FieldTitle>{t("settings.runtime.title")}</FieldTitle>
                <FieldDescription>
                  {t("settings.runtime.description")}
                </FieldDescription>
              </FieldContent>
              <div className="flex w-full min-w-0 flex-col gap-2 @md/field-group:max-w-sm">
                <Button
                  className="self-end"
                  variant="outline"
                  disabled={!system || !appVersion.data}
                  onClick={() => void copyRuntime()}
                >
                  <Copy data-icon="inline-start" />
                  {t("settings.runtime.copy")}
                </Button>
                <dl className="w-full divide-y overflow-hidden rounded-md border">
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
              </div>
            </Field>
          </FieldGroup>
        </div>
        <Separator />
        <div className="flex min-h-16 shrink-0 items-center justify-end gap-3 px-6 py-3">
          <Button variant="ghost" disabled={busy || saving} onClick={() => setResetOpen(true)}>{t("settingsUi.resetSettings")}</Button>
          <Button
            data-testid="settings-save"
            aria-busy={saving}
            disabled={busy || saving}
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
      <AlertDialog open={resetOpen} onOpenChange={(nextOpen) => { if (!resetting) setResetOpen(nextOpen); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settingsUi.resetSettings2")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settingsUi.resetDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>{t("settingsUi.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={busy || resetting} aria-busy={resetting} onClick={() => void handleReset()}>
              {resetting && <Spinner data-icon="inline-start" />}{t("settingsUi.confirmReset")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

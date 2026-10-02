import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { appApi } from "@/api/app";
import { appKeys } from "@/features/app/queries";
import type { LanguagePreference } from "@/i18n";
import type { AgentsSettingsPatch, ThemePreference } from "@/domain/types";
export type SettingsFormPatch = {
  language?: LanguagePreference;
  theme?: ThemePreference;
  agents?: AgentsSettingsPatch;
  keepDaemonRunningOnExit?: boolean;
  reset?: string[];
};
export function useSettingsSave() {
  const client = useQueryClient();
  const [saving, setSaving] = useState(false);
  const save = async (update: SettingsFormPatch) => {
    setSaving(true);
    try {
      await client.cancelQueries({ queryKey: appKeys.settings });
      const next = await appApi.updateSettings({
        reset: update.reset,
        language: update.language,
        theme: update.theme,
        agents: update.agents,
        amux:
          update.keepDaemonRunningOnExit === undefined
            ? undefined
            : { keep_daemon_running_on_exit: update.keepDaemonRunningOnExit },
      });
      client.setQueryData(appKeys.settings, next);
      if (update.agents || update.reset?.some(key => key.startsWith("agents."))) {
        await client.invalidateQueries({ queryKey: appKeys.system });
      }
      return { ok: true as const };
    } catch (cause) {
      return {
        ok: false as const,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    } finally {
      setSaving(false);
    }
  };
  return { save, saving };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { UpdateCheckResult } from "../../../../preload/bridge";
import { appApi } from "@/api/app";
import { appKeys } from "@/features/app/queries";
import { toast, toastManager } from "@/lib/toast";
import { shouldNotifyUpdate, updateReminderPatch, type UpdateReminderChoice } from "./reminders";

type AvailableUpdate = Extract<UpdateCheckResult, { status: "available" }>;

export function useUpdateReminders(onView: (release: AvailableUpdate) => void) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const noticeId = useRef<string | undefined>(undefined);
  const clearNotice = useCallback(() => {
    generation.current++;
    if (noticeId.current) toastManager.close(noticeId.current);
    noticeId.current = undefined;
  }, []);

  const notify = useCallback((release: AvailableUpdate) => {
    const current = ++generation.current;
    // Read the file through the backend each time, including external edits.
    void appApi.settings().then(settings => {
      if (current !== generation.current || busy.current || !shouldNotifyUpdate(release.version, settings.updates)) return;
      clearNotice();
      noticeId.current = toast.info(t("updates.available", { version: release.version }), {
        timeout: 0,
        actionProps: { children: t("updates.view"), onClick: () => { clearNotice(); onView(release); } },
      });
    }).catch(() => { /* A failed automatic check stays silent. */ });
  }, [clearNotice, onView, t]);
  useEffect(() => clearNotice, [clearNotice]);

  const save = async (choice: UpdateReminderChoice, version: string) => {
    if (busy.current) return false;
    busy.current = true;
    generation.current++;
    setSaving(true);
    try {
      await client.cancelQueries({ queryKey: appKeys.settings });
      const settings = await appApi.updateSettings(updateReminderPatch(choice, version));
      client.setQueryData(appKeys.settings, settings);
      clearNotice();
      return true;
    } catch {
      toast.error(t("updates.saveReminderFailed"));
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return { save, saving, clearNotice, notify };
}

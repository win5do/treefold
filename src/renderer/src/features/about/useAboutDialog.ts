import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UpdateCheckResult } from "../../../../preload/bridge";
import { desktop } from "@/lib/desktop";
import { useUpdateReminders } from "@/features/updates/useUpdateReminders";
import type { UpdateReminderChoice } from "@/features/updates/reminders";

export function useAboutDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const request = useRef(0);

  const openAbout = useCallback(() => {
    request.current++;
    setChecking(false);
    setResult(null);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    request.current++;
    setChecking(false);
    setOpen(false);
  }, []);
  const showUpdate = useCallback((available: Extract<UpdateCheckResult, { status: "available" }>) => {
    request.current++;
    setChecking(false);
    setResult(available);
    setOpen(true);
  }, []);
  const reminders = useUpdateReminders(showUpdate);
  const { clearNotice, notify } = reminders;
  const check = useCallback(async () => {
    clearNotice();
    const current = ++request.current;
    setOpen(true);
    setResult(null);
    setChecking(true);
    let next: UpdateCheckResult;
    try {
      next = await desktop!.checkForUpdates();
    } catch {
      next = { status: "error" };
    }
    // A completed request must not reopen a dismissed dialog or replace a newer check.
    if (request.current !== current) return;
    setChecking(false);
    setResult(next);
  }, [clearNotice]);

  const chooseReminder = async (choice: UpdateReminderChoice) => {
    if (result?.status !== "available") return;
    const current = request.current;
    if (await reminders.save(choice, result.version) && request.current === current) close();
  };

  useEffect(() => desktop?.onOpenAbout(openAbout), [openAbout]);
  useEffect(() => { desktop?.setUpdateMenuLabel(t("updates.check")); }, [t]);
  useEffect(() => desktop?.onCheckForUpdates(notice => {
    if (notice.source === "manual") {
      void check();
    } else notify(notice.result);
  }), [check, notify]);
  useEffect(() => () => { request.current++; }, []);

  return { open, result, checking, check, close, reminders: { choose: chooseReminder, saving: reminders.saving } };
}

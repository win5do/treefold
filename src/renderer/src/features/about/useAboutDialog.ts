import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UpdateCheckResult } from "../../../../preload/bridge";
import { desktop } from "@/lib/desktop";
import { toast } from "@/lib/toast";

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
  const check = useCallback(async () => {
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
  }, []);

  useEffect(() => desktop?.onOpenAbout(openAbout), [openAbout]);
  useEffect(() => { desktop?.setUpdateMenuLabel(t("updates.check")); }, [t]);
  useEffect(() => desktop?.onCheckForUpdates(notice => {
    if (notice.source === "manual") {
      void check();
      return;
    }
    toast.info(t("updates.available", { version: notice.result.version }), {
      timeout: 0,
      actionProps: { children: t("updates.view"), onClick: () => showUpdate(notice.result) },
    });
  }), [check, showUpdate, t]);
  useEffect(() => () => { request.current++; }, []);

  return { open, result, checking, check, close };
}

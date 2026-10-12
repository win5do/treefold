import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UpdateCheckResult } from "../../../../preload/bridge";
import { desktop } from "@/lib/desktop";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const upgradeCommand = "brew update && brew upgrade --cask win5do/tap/treefold";

export function UpdateDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);

  useEffect(() => {
    desktop?.setUpdateMenuLabel(t("updates.check"));
  }, [t]);

  useEffect(() => desktop?.onCheckForUpdates(notice => {
    if (notice.source === "startup") {
      const available = notice.result;
      toast.info(t("updates.available", { version: available.version }), {
        timeout: 0,
        actionProps: {
          children: t("updates.view"),
          onClick: () => { setResult(available); setOpen(true); },
        },
      });
      return;
    }
    setResult(null);
    setOpen(true);
    void desktop!.checkForUpdates().then(setResult).catch(() => setResult({ status: "error" }));
  }), [t]);

  const description = !result ? t("updates.checking")
    : result.status === "available" ? t("updates.available", { version: result.version })
    : result.status === "up-to-date" ? t("updates.upToDate")
    : result.status === "no-stable-release" ? t("updates.noStableRelease")
    : t("updates.failed");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("updates.check")}</DialogTitle>
          <DialogDescription aria-live="polite">{description}</DialogDescription>
        </DialogHeader>
        {result?.status === "available" && <>
          <p>{t("updates.brewInstructions")}</p>
          <code className="break-all select-text">{upgradeCommand}</code>
          <p className="text-muted-foreground">{t("updates.downloadInstructions")}</p>
          <DialogFooter>
            <Button nativeButton={false} role="link" render={<a href={result.url} target="_blank" rel="noopener noreferrer" />}>
              {t("updates.openRelease")}
            </Button>
          </DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  );
}

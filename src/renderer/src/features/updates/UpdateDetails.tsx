import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UpdateCheckResult } from "../../../../preload/bridge";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import type { UpdateReminderChoice } from "./reminders";

const upgradeCommand = "brew update && brew upgrade --cask win5do/tap/treefold";

export function UpdateDetails({ release, currentVersion, reminders }: {
  release: Extract<UpdateCheckResult, { status: "available" }>;
  currentVersion: string;
  reminders: { choose: (choice: UpdateReminderChoice) => Promise<void>; saving: boolean };
}) {
  const { t } = useTranslation();
  const title = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState(false);
  // This replaces About inside the same modal; move focus to the new content.
  useEffect(() => { title.current?.focus(); }, []);

  return <>
    <DialogHeader className="pr-5">
      <DialogTitle ref={title} tabIndex={-1} className="outline-none">{t("updates.available", { version: release.version })}</DialogTitle>
      <DialogDescription>{t("updates.versionChange", { current: currentVersion, next: release.version })}</DialogDescription>
    </DialogHeader>
    <div className="flex min-w-0 flex-col gap-3">
      <p>{t("updates.brewInstructions")}</p>
      <div className="flex min-w-0 items-start gap-2 rounded-md bg-muted p-3">
        <code className="min-w-0 flex-1 [overflow-wrap:anywhere] select-text">{upgradeCommand}</code>
        <Button variant="ghost" size="icon-sm" aria-label={t(copied ? "updates.commandCopied" : "updates.copyCommand")} onClick={async () => {
          try {
            await navigator.clipboard.writeText(upgradeCommand);
            setCopied(true);
          } catch { toast.error(t("updates.copyFailed")); }
        }}>{copied ? <CheckIcon data-icon /> : <CopyIcon data-icon />}</Button>
      </div>
      <span role="status" className="sr-only">{copied ? t("updates.commandCopied") : ""}</span>
      <p className="text-muted-foreground">{t("updates.downloadInstructions")}</p>
    </div>
    <DialogFooter className="flex-col sm:flex-col">
      <Button nativeButton={false} role="link" render={<a href={release.url} target="_blank" rel="noopener noreferrer" />}>
        {t("updates.openRelease")}<ExternalLinkIcon data-icon="inline-end" />
      </Button>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="outline" disabled={reminders.saving} onClick={() => void reminders.choose("skip")}>
          {t("updates.skip")}
        </Button>
        <Button variant="outline" disabled={reminders.saving} onClick={() => void reminders.choose("later")}>
          {t("updates.later")}
        </Button>
      </div>
    </DialogFooter>
  </>;
}

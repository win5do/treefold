import { useQuery } from "@tanstack/react-query";
import { CopyIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import appIcon from "../../../../../build/icons/icon.png";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { appVersionQuery } from "@/features/app/queries";
import { UpdateDetails } from "@/features/updates/UpdateDetails";
import { toast } from "@/lib/toast";
import { buildInfo } from "./buildInfo";
import { useAboutDialog } from "./useAboutDialog";

export function AboutDialog() {
  const state = useAboutDialog();
  const { t } = useTranslation();
  const version = useQuery(appVersionQuery()).data ?? buildInfo.version;
  const status = state.result?.status;
  const message = status === "up-to-date" ? t("updates.upToDate")
    : status === "no-stable-release" ? t("updates.noStableRelease")
    : status === "error" ? t("updates.failed") : "";

  return (
    <Dialog open={state.open} onOpenChange={open => { if (!open) state.close(); }}>
      <DialogContent className="gap-6 sm:max-w-sm">
        {state.result?.status === "available"
          ? <UpdateDetails release={state.result} currentVersion={version} reminders={state.reminders} />
          : <>
            <DialogHeader className="items-center gap-2 pt-2 text-center">
              <img src={appIcon} alt="" className="size-20" />
              <DialogTitle aria-label={t("about.title")}>Treefold</DialogTitle>
              <DialogDescription>{t("about.description")}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-2 text-center">
              <Button variant="outline" size="lg" disabled={state.checking} onClick={() => void state.check()}>
                {state.checking ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <RefreshCwIcon data-icon="inline-start" />}
                {state.checking ? t("updates.checking") : t("updates.check")}
              </Button>
              <p role="status" className="text-muted-foreground" hidden={!message}>{message}</p>
            </div>
            <Separator />
            <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-6 gap-y-3">
              <dt className="text-muted-foreground">{t("about.version")}</dt>
              <dd className="break-all select-text">{version}</dd>
              <dt className="text-muted-foreground">{t("about.commit")}</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <span className="font-mono select-text" title={buildInfo.commit ?? undefined}>
                  {buildInfo.commit?.slice(0, 7) ?? t("common.unavailable")}
                </span>
                {buildInfo.commit && <Button variant="ghost" size="icon-xs" aria-label={t("about.copyCommit")} onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(buildInfo.commit!);
                    toast.success(t("about.commitCopied"));
                  } catch { toast.error(t("about.copyFailed")); }
                }}><CopyIcon data-icon /></Button>}
              </dd>
              <AboutLink label={t("about.repository")} href={buildInfo.repository} text={new URL(buildInfo.repository).pathname.slice(1)} />
              <AboutLink label={t("about.website")} href={buildInfo.website} text={new URL(buildInfo.website).host} />
            </dl>
            <a href={buildInfo.author.url} target="_blank" rel="noopener noreferrer"
              className="justify-self-center text-muted-foreground underline-offset-4 hover:underline">
              {buildInfo.copyright.replace(/^Copyright \(C\)/, "©")}
            </a>
          </>}
      </DialogContent>
    </Dialog>
  );
}

function AboutLink({ label, href, text }: { label: string; href: string; text: string }) {
  return <>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0">
      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 underline-offset-4 hover:underline">
        <span className="min-w-0 break-all">{text}</span>
        <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
      </a>
    </dd>
  </>;
}

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { desktop } from "@/lib/desktop";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { appVersionQuery } from "@/features/app/queries";
import { buildInfo } from "./buildInfo";

export function AboutDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => desktop?.onOpenAbout(() => setOpen(true)), []);
  const { t } = useTranslation();
  const version = useQuery(appVersionQuery());
  const links = [
    { label: t("about.repository"), href: buildInfo.repository, text: buildInfo.repository },
    { label: t("about.website"), href: buildInfo.website, text: buildInfo.website },
    { label: t("about.author"), href: buildInfo.author.url, text: `@${buildInfo.author.name}` },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("about.title")}</DialogTitle>
          <DialogDescription>{t("about.description")}</DialogDescription>
        </DialogHeader>
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3">
          <dt className="text-muted-foreground">{t("about.version")}</dt>
          <dd className="break-all select-text">{version.data ?? buildInfo.version}</dd>
          <dt className="text-muted-foreground">{t("about.commit")}</dt>
          <dd className="break-all font-mono select-text">{buildInfo.commit ?? t("common.unavailable")}</dd>
          {links.map(({ label, href, text }) => (
            <AboutLink key={href} label={label} href={href} text={text} />
          ))}
        </dl>
        <p className="text-muted-foreground select-text">{buildInfo.copyright}</p>
      </DialogContent>
    </Dialog>
  );
}

function AboutLink({ label, href, text }: { label: string; href: string; text: string }) {
  return <>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0">
      <a href={href} target="_blank" rel="noopener noreferrer"
        className="break-all underline underline-offset-4">{text}</a>
    </dd>
  </>;
}

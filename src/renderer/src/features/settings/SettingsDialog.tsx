import { useQueryClient } from "@tanstack/react-query";
import { appKeys } from "@/features/app/queries";
import { useEffect, useState, type ComponentProps } from "react";
import { Bot, Keyboard, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SettingsAgents } from "./SettingsAgents";
import { SettingsPreferences } from "./SettingsPreferences";
import { KeymapSettings } from "@/features/keymap/KeymapSettings";

export function SettingsDialog(
  props: ComponentProps<typeof SettingsPreferences>,
) {
  const client = useQueryClient();
  useEffect(() => {
    if (props.open)
      void client.invalidateQueries({ queryKey: appKeys.settings });
  }, [props.open, client]);
  const [page, setPage] = useState("settings");
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex h-[80vh] max-h-[86vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b px-6 py-5">
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label={t("settingsUi.settingsCategories")}
            className="flex w-36 shrink-0 flex-col gap-1 border-r p-3"
          >
            <Button
              className="justify-start"
              variant={page === "settings" ? "secondary" : "ghost"}
              aria-current={page === "settings" ? "page" : undefined}
              onClick={() => setPage("settings")}
            >
              <Settings data-icon="inline-start" />{t("settingsUi.preferences")}</Button>
            <Button className="justify-start" variant={page === "agents" ? "secondary" : "ghost"}
              aria-current={page === "agents" ? "page" : undefined} onClick={() => setPage("agents")}>
              <Bot data-icon="inline-start" />{t("agentsUi.title")}
            </Button>
            <Button
              className="justify-start"
              variant={page === "keymap" ? "secondary" : "ghost"}
              aria-current={page === "keymap" ? "page" : undefined}
              onClick={() => setPage("keymap")}
            >
              <Keyboard data-icon="inline-start" />{t("settingsUi.keymap")}</Button>
          </nav>
          <div
            className={
              page === "settings" ? "flex min-h-0 min-w-0 flex-1" : "hidden"
            }
          >
            <SettingsPreferences {...props} />
          </div>
          <div className={page === "agents" ? "flex min-h-0 min-w-0 flex-1" : "hidden"}>
            <SettingsAgents settings={props.settings} busy={props.busy} onSave={props.onSave} />
          </div>
          {page === "keymap" && (
            <div className="min-w-0 flex-1 overflow-y-auto">
              <KeymapSettings />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

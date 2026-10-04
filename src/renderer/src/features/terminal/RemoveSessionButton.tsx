import { sessionDisplayName } from "@/features/terminal/model/sessionDisplayName";
import { isAgentKind } from "@/features/agents/model";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { sessionsApi } from "@/api/sessions";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import type { Session } from "@/domain/types";
import { toast } from "@/lib/toast";

export function RemoveSessionButton({ session, disabled }: { session: Session; disabled?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const queryClient = useQueryClient();
  if (!isAgentKind(session.kind)) return null;
  const remove = async () => {
    setRemoving(true);
    try {
      await sessionsApi.delete(session.id);
      await queryClient.invalidateQueries({ predicate: ({ queryKey }) => ["sidebar", "project-sessions", "workspace-sessions", "project", "workspace"].includes(String(queryKey[0])) });
      setOpen(false);
    } catch (cause) {
      toast.errorFrom(cause, t("terminalUi.couldNotRemoveSession"));
    } finally {
      setRemoving(false);
    }
  };
  return <>
    <Button size="icon-sm" variant="destructive-ghost" disabled={disabled || removing} title={t("terminalUi.removeFromTreefold")} aria-label={t("terminalUi.removeFromTreefold")} onClick={() => setOpen(true)}><Trash2 data-icon="inline-start" /></Button>
    <AlertDialog open={open} onOpenChange={(value) => { if (!removing) setOpen(value); }}>
      <AlertDialogContent>
        <AlertDialogTitle>{t("terminalUi.removeSessionFromTreefold")}</AlertDialogTitle>
        <AlertDialogDescription>{t("terminalUi.removeDescription", { name: sessionDisplayName(session) })}</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removing}>{t("terminalUi.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={removing} onClick={() => void remove()}>{t("terminalUi.remove")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

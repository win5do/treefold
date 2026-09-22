import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

export function ForceFinishWorkspace({
  repositories,
  ready,
  busy,
  execute,
}: {
  repositories: { id: string; repository_name: string }[];
  ready: boolean;
  busy: boolean;
  execute: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="destructive"
        disabled={!ready || busy}
        onClick={() => setOpen(true)}
      >
        {t("deliveryUi.recovery.forceExecute")}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <AlertDialogContent className="max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("deliveryUi.recovery.forceTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("deliveryUi.recovery.forceDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="list-inside list-disc text-sm">
            {repositories.map((repository) => (
              <li key={repository.id} className="break-words">
                {repository.repository_name}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            {t("deliveryUi.recovery.forceConsequences")}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t("deliveryUi.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!ready || busy}
              onClick={async () => {
                await execute();
                setOpen(false);
              }}
            >
              {t("deliveryUi.recovery.forceExecute")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

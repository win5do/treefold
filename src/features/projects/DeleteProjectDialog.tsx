import { useEffect, useState } from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { projectsApi } from "@/api/projects";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
  ProjectDeletePrecheck,
  ProjectDetail,
  ProjectSummary,
} from "@/domain/types";

export function DeleteProjectDialog({
  target,
  busy,
  onOpenChange,
  onConfirm,
}: {
  target: ProjectDetail | ProjectSummary | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (cleanupManaged: boolean) => void;
}) {
  const { t } = useTranslation();
  const [strategy, setStrategy] = useState<"cleanup" | "preserve">("cleanup");
  const [precheck, setPrecheck] = useState<ProjectDeletePrecheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [precheckError, setPrecheckError] = useState("");

  useEffect(() => {
    setStrategy("cleanup");
    setPrecheck(null);
    setPrecheckError("");
    if (!target) return;
    const controller = new AbortController();
    setChecking(true);
    void projectsApi
      .deletePrecheck(target.id, controller.signal)
      .then(setPrecheck)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setPrecheckError(
            cause instanceof Error
              ? cause.message
              : t("overview.deletePrecheckFailed"),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [target, t]);

  const cleanupBlocked = Boolean(
    checking || precheckError || precheck?.status === "blocked",
  );
  const canConfirm = !busy && (strategy === "preserve" || !cleanupBlocked);

  return (
    <AlertDialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <AlertDialogContent
        data-testid="delete-record-dialog"
        className="sm:max-w-md"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("overview.deleteTitle", {
              type: "project",
              name: target?.name,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("overview.deleteProjectConfirmation")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ToggleGroup
          aria-label={t("overview.deleteStrategy.label")}
          orientation="vertical"
          variant="outline"
          value={[strategy]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "cleanup" || next === "preserve") setStrategy(next);
          }}
          className="w-full"
        >
          <ToggleGroupItem
            value="cleanup"
            disabled={cleanupBlocked}
            data-testid="delete-project-cleanup"
            className="h-auto w-full justify-start whitespace-normal py-2 text-left"
          >
            <span className="flex flex-col gap-0.5">
              <span>{t("overview.deleteStrategy.cleanupTitle")}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {t("overview.deleteStrategy.cleanupDescription")}
              </span>
            </span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="preserve"
            data-testid="delete-project-preserve"
            className="h-auto w-full justify-start whitespace-normal py-2 text-left"
          >
            <span className="flex flex-col gap-0.5">
              <span>{t("overview.deleteStrategy.preserveTitle")}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {t("overview.deleteStrategy.preserveDescription")}
              </span>
            </span>
          </ToggleGroupItem>
        </ToggleGroup>

        {checking && (
          <Alert data-testid="delete-project-checking">
            <Spinner />
            <AlertTitle>{t("overview.deletePrecheckChecking")}</AlertTitle>
            <AlertDescription>
              {t("overview.deletePrecheckCheckingDescription")}
            </AlertDescription>
          </Alert>
        )}
        {precheckError && (
          <Alert
            variant="destructive"
            data-testid="delete-project-precheck-error"
          >
            <TriangleAlert />
            <AlertTitle>{t("overview.deletePrecheckFailed")}</AlertTitle>
            <AlertDescription>{precheckError}</AlertDescription>
          </Alert>
        )}
        {precheck?.status === "blocked" && (
          <Alert variant="warning" data-testid="delete-project-cleanup-blocked">
            <TriangleAlert />
            <AlertTitle>{t("overview.deleteCleanupBlocked")}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {precheck.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {precheck?.status === "ready" && (
          <Alert data-testid="delete-project-cleanup-ready">
            <CircleCheck />
            <AlertTitle>{t("overview.deleteCleanupReady")}</AlertTitle>
            <AlertDescription>
              {t("overview.deleteCleanupSummary", {
                sources: precheck.managed_sources.length,
                worktrees: precheck.managed_worktrees.length,
              })}
            </AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!canConfirm}
            onClick={() => onConfirm(strategy === "cleanup")}
          >
            {t("overview.permanentlyDelete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

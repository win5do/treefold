import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { DeliveryPreflight, FinishPlanItem, WorkspaceRepository } from "@/domain/types";
import { finishErrorText, isWorktreeError, type FinishError } from "./finishErrors";

export function DeliveryBlockers({ repositories, drafts, preflights, checks, onOpenSettings, onReviewChanges }: {
  repositories: WorkspaceRepository[];
  drafts: Record<string, Pick<FinishPlanItem, "code_action">>;
  preflights: Record<string, DeliveryPreflight>;
  checks: Record<string, FinishError>;
  onOpenSettings: (repositoryId: string) => void;
  onReviewChanges: (repositoryId: string) => void;
}) {
  const { t } = useTranslation();
  const blocked = repositories.flatMap(repository => {
    const check = preflights[repository.id];
    const error = checks[repository.id];
    const missingUpstream = drafts[repository.id]?.code_action === "push_branch"
      && !(repository.remote_name && repository.remote_branch);
    const messages = missingUpstream
      ? [t("deliveryUi.upstreamRequired")]
      : [...(check?.blockers ?? []).map(message => finishErrorText({ message }, t)), ...(error ? [finishErrorText(error, t)] : [])];
    if (isWorktreeError(error?.code)) messages.push(t("deliveryUi.recovery.repairHint"));
    return messages.length ? [{ repository, messages, missingUpstream, sourceDirty: check?.source_dirty }] : [];
  });
  if (!blocked.length) return null;
  return (
    <Alert variant="destructive" className="shrink-0">
      <CircleAlert />
      <AlertTitle>{t("deliveryUi.deliveryBlocked")}</AlertTitle>
      <AlertDescription className="flex max-h-32 min-w-0 flex-col gap-2 overflow-y-auto">
        {blocked.map(({ repository, messages, missingUpstream, sourceDirty }) => (
          <div key={repository.id} data-testid={`delivery-blocker-${repository.id}`} className="flex flex-col gap-1">
            <span className="break-words">{repository.repository_name}</span>
            {messages.map(message => <span key={message} className="break-words">{message}</span>)}
            {sourceDirty && (
              <Button size="sm" variant="outline" className="self-start" onClick={() => onReviewChanges(repository.id)}>
                {t("deliveryUi.viewChanges")}
              </Button>
            )}
            {missingUpstream && (
              <Button size="sm" variant="outline" className="self-start" onClick={() => onOpenSettings(repository.id)}>
                {t("deliveryUi.openWorkspaceSettings")}
              </Button>
            )}
          </div>
        ))}
      </AlertDescription>
    </Alert>
  );
}

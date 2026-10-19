import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContextMenuItem } from "@/components/ui/context-menu";
import type { Workspace, WorkspaceRepository } from "@/domain/types";
import type { AgentReviewActions, AgentReviewTarget } from "./model";

export function AgentReviewMenuItem({ workspace, actions, busy }: {
  workspace: Workspace & AgentReviewTarget & { repositories?: WorkspaceRepository[] };
  actions: AgentReviewActions;
  busy: boolean;
}) {
  const { t } = useTranslation();
  if (workspace.status !== "active") return null;
  const repositories = workspace.repositories ?? [];
  const disabled = busy || repositories.some(repository => repository.git_status === "creating") ||
    !repositories.some(repository => repository.access_mode === "read_write" && repository.git_status === "ready");
  return <ContextMenuItem disabled={disabled} onClick={() => actions.open(workspace)}>
    <Bot />{t("agentReview.title")}
  </ContextMenuItem>;
}

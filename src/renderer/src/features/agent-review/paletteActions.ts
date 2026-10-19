import type { ActionHandlers } from "@/features/actions/model";
import { ownerScope } from "@/features/actions/model/context";
import type { AgentReviewActions } from "./model";

export function agentReviewPaletteActions(handlers: AgentReviewActions, busy: boolean): ActionHandlers<"workspace.review.open"> {
  return {
    "workspace.review.open": {
      paletteScope: ownerScope,
      available: ({ project, workspace }) => !busy && project?.status === "active" &&
        !!workspace && (workspace.kind === "workspace" || workspace.kind === "fork") && workspace.status === "active" &&
        (!workspace.finish_batch || workspace.finish_batch.status === "completed") &&
        !workspace.repositories.some(repository => repository.git_status === "creating") &&
        workspace.repositories.some(repository => repository.access_mode === "read_write" && repository.git_status === "ready"),
      run: ({ workspace }) => { if (workspace) handlers.open(workspace); },
    },
  };
}

import type { TFunction } from "i18next";
import type { ActionContext, ActionHandlers, PaletteEntry } from "@/features/actions/model";
import { ownerScope } from "@/features/actions/model/context";

export type GitPaletteHandlers = {
  sync: (context: ActionContext, action: "pull" | "push", repositoryId: string | null) => void;
};

function syncTargets(context: ActionContext) {
  if (context.workspace) {
    if (context.workspace.kind === "fork") return [];
    return context.workspace.repositories
      .filter((repository) => repository.access_mode === "read_write" && repository.git_status === "ready")
      .map((repository) => ({ id: repository.id, name: repository.repository_name }));
  }
  return (context.project?.repositories ?? [])
    .filter((repository) => repository.git_status === "ready")
    .map((repository) => ({ id: repository.id, name: repository.name }));
}

export function gitPaletteActions(
  handlers: GitPaletteHandlers,
  busy: boolean,
  t: TFunction,
): ActionHandlers<"git.sync.push" | "git.sync.pull"> {
  function behavior(action: "push" | "pull") {
    return {
      paletteScope: ownerScope,
      available: (context: ActionContext) => !busy && context.project?.status === "active" &&
        (!context.workspace || context.workspace.status === "active") && syncTargets(context).length > 0,
      children: (context: ActionContext): PaletteEntry[] => {
        const actionId = `git.sync.${action}` as const;
        const targets = [{ id: null, name: t(`sidebar.${action}All`) }, ...syncTargets(context)];
        return targets.map((target) => ({
          id: `${actionId}:${target.id ?? "all"}`,
          actionId,
          name: target.id === null ? `${action === "push" ? "Push" : "Pull"} All` : target.name,
          label: target.name,
          scope: ownerScope(context),
          run: () => handlers.sync(context, action, target.id),
        }));
      },
    };
  }
  return { "git.sync.push": behavior("push"), "git.sync.pull": behavior("pull") };
}

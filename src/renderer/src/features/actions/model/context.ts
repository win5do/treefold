import type { ActionContext } from "./types.ts";
import type { ActionScope } from "./metadata.ts";

export function ownerScope(context: ActionContext): ActionScope {
  return context.workspace
    ? context.workspace.kind === "fork" ? "fork" : "workspace"
    : "project";
}

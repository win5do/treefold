import type {
  Directory,
  ProjectDetail,
  Session,
  WorkspaceDetail,
} from "@/domain/types";
import type { ActionId, ActionDefinition } from "./registry.ts";
import type { ActionScope } from "./metadata.ts";
export type ActionContext = Readonly<{
  project: ProjectDetail | null;
  workspace: WorkspaceDetail | null;
  session: Session | null;
  directory: Directory | null;
  pathname: string;
  scope: ActionScope;
}>;
export type ActionBehavior = {
  run: (context: ActionContext) => void;
  available: (context: ActionContext) => boolean;
};
export type AppAction = ActionDefinition & ActionBehavior;
export type ActionHandlers<Id extends ActionId = ActionId> = Record<
  Id,
  ActionBehavior
>;
export type ActionInvocation = {
  context: ActionContext;
  actions: AppAction[];
  returnFocus: HTMLElement | null;
};

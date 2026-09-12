import type {
  Directory,
  ProjectDetail,
  Session,
  WorkspaceDetail,
} from "@/domain/types";
import type { CommandId } from "@/features/keymap/api";

export type ActionScope =
  "global" | "project" | "workspace" | "fork" | "session";
export type ActionContext = Readonly<{
  project: ProjectDetail | null;
  workspace: WorkspaceDetail | null;
  session: Session | null;
  directory: Directory | null;
  pathname: string;
  scope: ActionScope;
}>;
export type AppAction = {
  id: `${string}.${string}.${string}`;
  name: string;
  scope: ActionScope;
  /** Existing config keys remain stable independently of the action ID. */
  keymapId?: CommandId;
  run: (context: ActionContext) => void;
  available: (context: ActionContext) => boolean;
};
export type ActionInvocation = {
  context: ActionContext;
  actions: AppAction[];
  returnFocus: HTMLElement | null;
};

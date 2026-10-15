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
export type PaletteEntry = {
  /** Unique choice identity; parameters are not part of the displayed action ID. */
  id: string;
  actionId: ActionId;
  name: string;
  label: string;
  scope: ActionScope;
  keymapId?: string;
} & (
  | { run: () => void; children?: never }
  | { run?: never; children: () => PaletteEntry[] | Promise<PaletteEntry[]> }
);
export type ActionBehavior = {
  available: (context: ActionContext) => boolean;
  paletteScope?: (context: ActionContext) => ActionScope;
} & (
  | { run: (context: ActionContext) => void; children?: never }
  | { run?: never; children: (context: ActionContext) => PaletteEntry[] | Promise<PaletteEntry[]> }
);
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

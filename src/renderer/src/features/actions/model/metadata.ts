export type ActionScope =
  "global" | "project" | "workspace" | "fork" | "session";
export type ActionMetadata = {
  name: string;
  scope: ActionScope;
  allowInInput?: boolean;
  showInPalette?: boolean;
} & (
  | { keymapId: string; defaultBinding: string }
  | { keymapId?: never; defaultBinding?: never }
);

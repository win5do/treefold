import { appActions } from "./app.ts";
import { sessionActions } from "./session.ts";
import type { ActionMetadata, ActionScope } from "./metadata.ts";

export type AppActionId = keyof typeof appActions;
export type SessionActionId = keyof typeof sessionActions;
export type ActionId = AppActionId | SessionActionId;
type Metadata =
  (typeof appActions)[AppActionId] | (typeof sessionActions)[SessionActionId];
export type KeymapId = Extract<Metadata, { keymapId: string }>["keymapId"];
export type ActionDefinition = Readonly<{ id: ActionId } & ActionMetadata>;
export const actionScopes: readonly ActionScope[] = [
  "global",
  "project",
  "workspace",
  "fork",
  "session",
];

const ids = new Set<string>();
const bindings = new Set<string>();
const definitions: ActionDefinition[] = [];
for (const domain of [appActions, sessionActions]) {
  for (const [id, metadata] of Object.entries(domain)) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/.test(
        id,
      ) ||
      ids.has(id)
    ) {
      throw new Error(`Invalid or duplicate action ID: ${id}`);
    }
    ids.add(id);
    if ("keymapId" in metadata) {
      if (bindings.has(metadata.keymapId))
        throw new Error(`Duplicate keymap ID: ${metadata.keymapId}`);
      bindings.add(metadata.keymapId);
    }
    definitions.push(Object.freeze({ id: id as ActionId, ...metadata }));
  }
}
export const actionDefinitions: readonly ActionDefinition[] =
  Object.freeze(definitions);
export function getActionDefinition(id: ActionId): ActionDefinition {
  const definition = actionDefinitions.find((action) => action.id === id);
  if (!definition) throw new Error(`Unknown action: ${id}`);
  return definition;
}
// Preserve the existing HTTP/config command order independently of palette order.
export const keymapDefaults = [sessionActions, appActions].flatMap((domain) =>
  Object.values(domain).flatMap((action): [KeymapId, string, string][] =>
    "keymapId" in action
      ? [[action.keymapId, action.name, action.defaultBinding]]
      : [],
  ),
);

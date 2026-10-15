import { appActions } from "./app.ts";
import { sessionActions } from "./session.ts";
import { contextualActions } from "./contextual.ts";
import type { ActionMetadata, ActionScope } from "./metadata.ts";

export type AppActionId = keyof typeof appActions;
export type SessionActionId = keyof typeof sessionActions;
export type ContextualActionId = keyof typeof contextualActions;
export type ActionId = AppActionId | SessionActionId | ContextualActionId;
type DomainKeymapId<Domain> = {
  [Id in keyof Domain]: Domain[Id] extends { keymapId: infer KeymapId extends string } ? KeymapId : Id;
}[keyof Domain];
export type KeymapId = DomainKeymapId<typeof appActions> | DomainKeymapId<typeof sessionActions> | DomainKeymapId<typeof contextualActions>;
export type ActionDefinition = Readonly<{
  id: ActionId;
  keymapId: KeymapId;
  defaultBinding: string | false;
} & Omit<ActionMetadata, "keymapId" | "defaultBinding">>;
export const actionScopes: readonly ActionScope[] = [
  "session",
  "fork",
  "workspace",
  "project",
  "global",
];

const ids = new Set<string>();
const bindings = new Set<string>();
const definitions: ActionDefinition[] = [];
for (const domain of [appActions, sessionActions, contextualActions]) {
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
    const keymapId = ("keymapId" in metadata ? metadata.keymapId : id) as KeymapId;
    if (bindings.has(keymapId)) throw new Error(`Duplicate keymap ID: ${keymapId}`);
    bindings.add(keymapId);
    definitions.push(Object.freeze({
      ...metadata,
      id: id as ActionId,
      keymapId,
      defaultBinding: "defaultBinding" in metadata ? metadata.defaultBinding : false,
    }));
  }
}
export const actionDefinitions: readonly ActionDefinition[] =
  Object.freeze(definitions);
export function getActionDefinition(id: ActionId): ActionDefinition {
  const definition = actionDefinitions.find((action) => action.id === id);
  if (!definition) throw new Error(`Unknown action: ${id}`);
  return definition;
}
// Keep the existing Session config IDs; other actions use their action ID.
export const keymapDefaults: readonly [KeymapId, string, string | false][] =
  [sessionActions, appActions, contextualActions].flatMap((domain) =>
    Object.keys(domain).map((id): [KeymapId, string, string | false] => {
      const action = getActionDefinition(id as ActionId);
      return [action.keymapId, action.name, action.defaultBinding];
    }),
  );

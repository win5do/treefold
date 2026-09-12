import { actionDefinitions } from "./registry.ts";
import type { ActionHandlers, AppAction } from "./types.ts";
export function bindActions(handlers: ActionHandlers): AppAction[] {
  return actionDefinitions.map((definition) => ({
    ...definition,
    ...handlers[definition.id],
  }));
}

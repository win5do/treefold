import type { TFunction } from "i18next";
import { actionDefinitions, type ActionId } from "./model";

export function actionLabel(t: TFunction, id: ActionId): string {
  const definition = actionDefinitions.find((action) => action.id === id)!;
  return t(`actionLabels.${id}`, { defaultValue: definition.name });
}

export function keymapLabel(t: TFunction, id: string, fallback: string): string {
  const definition = actionDefinitions.find((action) => action.keymapId === id);
  return definition ? actionLabel(t, definition.id) : fallback;
}

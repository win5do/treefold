import type { ActionMetadata } from "./metadata.ts";
export const sessionActions = {
  "session.create.new": {
    name: "New Session",
    scope: "session",
    keymapId: "session.new",
    defaultBinding: "super+t",
  },
  "session.lifecycle.close": {
    name: "Close Session",
    scope: "session",
    keymapId: "session.close",
    defaultBinding: "super+w",
  },
  "session.navigate.next": {
    name: "Next Session",
    scope: "session",
    keymapId: "session.next",
    defaultBinding: "ctrl+tab",
  },
  "session.navigate.previous": {
    name: "Previous Session",
    scope: "session",
    keymapId: "session.previous",
    defaultBinding: "ctrl+shift+tab",
  },
} as const satisfies Record<`${string}.${string}.${string}`, ActionMetadata>;

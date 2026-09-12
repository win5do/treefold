import type { ActionMetadata } from "./metadata.ts";
export const appActions = {
  "app.settings.open": { name: "Open Settings", scope: "global" },
  "app.projects.open": { name: "Open Projects", scope: "global" },
  "app.leftSidebar.toggle": { name: "Toggle Left Sidebar", scope: "global" },
  "app.rightSidebar.toggle": { name: "Toggle Right Sidebar", scope: "global" },
  "app.palette.open": {
    name: "Command Palette",
    scope: "global",
    keymapId: "app.palette.open",
    defaultBinding: "super+shift+p",
    allowInInput: true,
    showInPalette: false,
  },
} as const satisfies Record<`${string}.${string}.${string}`, ActionMetadata>;

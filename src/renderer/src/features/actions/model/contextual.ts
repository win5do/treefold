import type { ActionMetadata } from "./metadata.ts";

export const contextualActions = {
  "workspace.review.open": { name: "AI Review", scope: "workspace" },
  "git.sync.push": { name: "Push", scope: "project" },
  "git.sync.pull": { name: "Pull", scope: "project" },
  "directory.open.with": { name: "Open With", scope: "project" },
} as const satisfies Record<`${string}.${string}.${string}`, ActionMetadata>;

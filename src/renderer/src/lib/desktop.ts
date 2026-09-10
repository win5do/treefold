import type { DirectoryOptions } from "../../../preload/bridge";

export const desktop = window.treefoldDesktop;
export async function open(options: DirectoryOptions): Promise<string | null> {
  if (!desktop) throw new Error("Directory selection is available in the Treefold desktop app. Enter a path instead.");
  return desktop.openDirectory(options);
}

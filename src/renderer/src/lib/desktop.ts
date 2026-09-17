import i18n from "@/i18n";
import type { DirectoryOptions } from "../../../preload/bridge";

export const desktop = window.treefoldDesktop;
export async function open(options: DirectoryOptions): Promise<string | null> {
  if (!desktop) throw new Error(i18n.t("feedback.directoryPickerUnavailable"));
  return desktop.openDirectory(options);
}

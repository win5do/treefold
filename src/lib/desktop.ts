type DirectoryOptions = { title?: string; directory: true; multiple: false };
export interface DesktopBridge {
  apiUrl(): Promise<string>;
  openDirectory(options: DirectoryOptions): Promise<string | null>;
  log(level: "debug" | "info" | "warn" | "error", message: string): Promise<void>;
}
declare global {
  interface Window { treefoldDesktop?: DesktopBridge }
}
export const desktop = window.treefoldDesktop;
export async function open(options: DirectoryOptions): Promise<string | null> {
  if (!desktop) throw new Error("Directory selection is available in the Treefold desktop app. Enter a path instead.");
  return desktop.openDirectory(options);
}

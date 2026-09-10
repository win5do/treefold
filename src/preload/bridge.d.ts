export type DirectoryOptions = { title?: string; directory: true; multiple: false };
export interface DesktopBridge {
  apiUrl(): Promise<string>;
  openDirectory(options: DirectoryOptions): Promise<string | null>;
  log(level: "debug" | "info" | "warn" | "error", message: string): Promise<void>;
}
declare global {
  interface Window { treefoldDesktop?: DesktopBridge }
}

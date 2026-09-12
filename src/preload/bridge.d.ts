export type OpenInApp = { id: string; label: string; group: "fileManager" | "editor" | "terminal" };
export type DirectoryOptions = { title?: string; directory: true; multiple: false };
export interface DesktopBridge {
  listOpenInApps(): Promise<OpenInApp[]>;
  openInApp(id: string, directory: string): Promise<void>;
  apiUrl(): Promise<string>;
  openDirectory(options: DirectoryOptions): Promise<string | null>;
  log(level: "debug" | "info" | "warn" | "error", message: string): Promise<void>;
}
declare global {
  interface Window { treefoldDesktop?: DesktopBridge }
}

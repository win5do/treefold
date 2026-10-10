export type OpenInApp = { id: string; label: string; group: "fileManager" | "editor" | "terminal" };
export type DirectoryOptions = { title?: string; directory: true; multiple: false };
export type OpenProjectRequest = { id: number; path: string };
export interface DesktopBridge {
  pendingOpenProject(): Promise<OpenProjectRequest | null>;
  acknowledgeOpenProject(id: number): Promise<void>;
  onOpenProject(listener: (request: OpenProjectRequest) => void): () => void;
  listOpenInApps(): Promise<OpenInApp[]>;
  openInApp(id: string, directory: string): Promise<void>;
  apiUrl(): Promise<string>;
  appVersion(): Promise<string>;
  openDirectory(options: DirectoryOptions): Promise<string | null>;
  log(level: "debug" | "info" | "warn" | "error", message: string): Promise<void>;
}
declare global {
  interface Window { treefoldDesktop?: DesktopBridge }
}

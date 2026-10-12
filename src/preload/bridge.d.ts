export type UpdateCheckResult =
  | { status: 'available'; version: string; url: string }
  | { status: 'up-to-date' | 'no-stable-release' | 'error' };
export type UpdateNotice = { source: 'manual' } | { source: 'startup'; result: Extract<UpdateCheckResult, { status: 'available' }> };
export type OpenInApp = { id: string; label: string; group: "fileManager" | "editor" | "terminal" };
export type DirectoryOptions = { title?: string; directory: true; multiple: false };
export type OpenProjectRequest = { id: number; path: string };
export interface DesktopBridge {
  checkForUpdates(): Promise<UpdateCheckResult>;
  onCheckForUpdates(listener: (notice: UpdateNotice) => void): () => void;
  setUpdateMenuLabel(label: string): void;
  onOpenAbout(listener: () => void): () => void;
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

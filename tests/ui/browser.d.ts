export {};

declare global {
  interface Window {
    __treefoldCopiedPath: string | null;
    __terminalInputFrames: { type: string; client_id: string; sequence: number; data: string }[];
    __terminalControllerReady: boolean;
    __terminalSocketUrls: string[];
    __terminalSocketSends: string[];
    __terminalReplay: { outputs: string[]; cursors: string[]; delivered: number; responses: string };
  }
}

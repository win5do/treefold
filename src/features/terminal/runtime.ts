import { ReliableTerminalInputQueue } from "@/features/terminal/inputQueue";

const controllerStorageKey = "treefold.terminal.controller-client-id";
let fallbackControllerClientId: string | undefined;

export function terminalControllerClientId(): string {
  if (fallbackControllerClientId) return fallbackControllerClientId;
  try {
    const existing = window.sessionStorage.getItem(controllerStorageKey);
    if (existing) return (fallbackControllerClientId = existing);
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(controllerStorageKey, created);
    return (fallbackControllerClientId = created);
  } catch {
    return (fallbackControllerClientId = crypto.randomUUID());
  }
}

export type TerminalOwnership = "connecting" | "controller" | "readonly";

export type TerminalRuntime = {
  controllerClientId: string;
  inputClientId: string;
  inputQueue: ReliableTerminalInputQueue;
  lastOutputSequence: bigint | null;
  ownership: TerminalOwnership;
  gapNotified: boolean;
};

export function createTerminalRuntime(): TerminalRuntime {
  return {
    controllerClientId: terminalControllerClientId(),
    inputClientId: crypto.randomUUID(),
    inputQueue: new ReliableTerminalInputQueue(),
    lastOutputSequence: null,
    ownership: "connecting",
    gapNotified: false,
  };
}

export function decodeSequencedOutput(frame: ArrayBuffer): { sequence: bigint; data: Uint8Array } | null {
  if (frame.byteLength < 8) return null;
  const sequence = new DataView(frame).getBigUint64(0, false);
  return { sequence, data: new Uint8Array(frame, 8) };
}

export function acceptOutputSequence(runtime: TerminalRuntime, sequence: bigint): boolean {
  if (runtime.lastOutputSequence !== null && sequence <= runtime.lastOutputSequence) return false;
  runtime.lastOutputSequence = sequence;
  return true;
}

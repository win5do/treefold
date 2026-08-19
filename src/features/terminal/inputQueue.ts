export const maxSinglePasteBytes = 1024 * 1024;
export const maxQueuedBytes = 1024 * 1024;
export const terminalInputFrameBytes = 16 * 1024;

export type PreparedTerminalInput =
  | { accepted: true; frames: ArrayBuffer[]; byteLength: number }
  | { accepted: false; reason: "single-input-too-large" | "queue-full"; pauseStdin: boolean };

export function prepareTerminalInput(data: string, pendingBytes: number): PreparedTerminalInput {
  const encoded = new TextEncoder().encode(data);
  if (encoded.byteLength > maxSinglePasteBytes) {
    return { accepted: false, reason: "single-input-too-large", pauseStdin: false };
  }
  if (pendingBytes + encoded.byteLength > maxQueuedBytes) {
    return { accepted: false, reason: "queue-full", pauseStdin: true };
  }
  const frames: ArrayBuffer[] = [];
  for (let offset = 0; offset < encoded.byteLength; offset += terminalInputFrameBytes) {
    frames.push(encoded.slice(offset, offset + terminalInputFrameBytes).buffer as ArrayBuffer);
  }
  return { accepted: true, frames, byteLength: encoded.byteLength };
}

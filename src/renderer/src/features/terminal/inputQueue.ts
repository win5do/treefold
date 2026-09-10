export const maxSinglePasteBytes = 1024 * 1024;
export const pauseQueuedBytes = 1024 * 1024;
export const maxQueuedBytes = 2 * 1024 * 1024;
export const terminalInputFrameBytes = 16 * 1024;

export type QueuedTerminalInput = {
  sequence: number;
  byteLength: number;
  wire: string;
  sent: boolean;
};

export type EnqueueTerminalInput =
  | { accepted: true; byteLength: number; pauseStdin: boolean }
  | { accepted: false; reason: "single-input-too-large" | "queue-full"; pauseStdin: boolean };

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export class ReliableTerminalInputQueue {
  private readonly frames: QueuedTerminalInput[] = [];
  private nextSequence = 1;
  private queuedBytes = 0;

  get pendingBytes(): number {
    return this.queuedBytes;
  }

  get hasUnsent(): boolean {
    return this.frames.some((frame) => !frame.sent);
  }

  get shouldPauseStdin(): boolean {
    return this.queuedBytes >= pauseQueuedBytes;
  }

  enqueue(data: string): EnqueueTerminalInput {
    const encoded = new TextEncoder().encode(data);
    if (encoded.byteLength > maxSinglePasteBytes) {
      return { accepted: false, reason: "single-input-too-large", pauseStdin: false };
    }
    if (this.queuedBytes + encoded.byteLength > maxQueuedBytes) {
      return { accepted: false, reason: "queue-full", pauseStdin: true };
    }
    for (let offset = 0; offset < encoded.byteLength; offset += terminalInputFrameBytes) {
      const bytes = encoded.slice(offset, offset + terminalInputFrameBytes);
      const sequence = this.nextSequence++;
      this.frames.push({
        sequence,
        byteLength: bytes.byteLength,
        wire: JSON.stringify({ type: "input", sequence, data: base64(bytes) }),
        sent: false,
      });
      this.queuedBytes += bytes.byteLength;
    }
    return { accepted: true, byteLength: encoded.byteLength, pauseStdin: this.shouldPauseStdin };
  }

  takeUnsent(): QueuedTerminalInput | undefined {
    const frame = this.frames.find((candidate) => !candidate.sent);
    if (frame) frame.sent = true;
    return frame;
  }

  acknowledge(sequence: number): boolean {
    const last = this.frames.at(-1)?.sequence ?? this.nextSequence - 1;
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > last) return false;
    while (this.frames[0]?.sequence <= sequence) {
      this.queuedBytes -= this.frames.shift()!.byteLength;
    }
    return true;
  }

  reconnect(): void {
    for (const frame of this.frames) frame.sent = false;
  }
}

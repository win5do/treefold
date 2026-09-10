import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { Session } from "@/domain/types";
import type { TerminalRuntime } from "./runtime";

type SessionIdentity = Pick<Session, "id" | "launch_started_at" | "amux_process_name">;
export type CachedTerminalSession = {
  terminal: Terminal;
  fit: FitAddon;
  runtime: TerminalRuntime;
};

// Only detached terminals live here. Keep parser state (including incomplete
// escape sequences), screen buffers, and output cursor together as one unit.
const detachedSessions = new Map<string, { identity: SessionIdentity; value: CachedTerminalSession }>();
const maxDetachedSessions = 4;

export function takeTerminalSession(identity: SessionIdentity): CachedTerminalSession | undefined {
  const cached = detachedSessions.get(identity.id);
  if (!cached) return;
  detachedSessions.delete(identity.id);
  if (cached.identity.launch_started_at !== identity.launch_started_at ||
      cached.identity.amux_process_name !== identity.amux_process_name) {
    cached.value.terminal.dispose();
    return;
  }
  return cached.value;
}

export function discardTerminalSession(id: string): void {
  const cached = detachedSessions.get(id);
  detachedSessions.delete(id);
  cached?.value.terminal.dispose();
}

export function retainTerminalSession(identity: SessionIdentity, value: CachedTerminalSession): void {
  discardTerminalSession(identity.id);
  detachedSessions.set(identity.id, { identity: { ...identity }, value });
  while (detachedSessions.size > maxDetachedSessions) {
    discardTerminalSession(detachedSessions.keys().next().value!);
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const id of detachedSessions.keys()) discardTerminalSession(id);
  });
}

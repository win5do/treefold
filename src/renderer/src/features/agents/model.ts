import type { AgentKind } from "@/domain/types";

export const AGENT_KINDS: AgentKind[] = ["codex", "claude_code", "opencode", "pi"];
export const AGENT_NAMES: Record<AgentKind, string> = {
  codex: "Codex", claude_code: "Claude Code", opencode: "OpenCode", pi: "Pi",
};
export const AGENT_EXECUTABLES: Record<AgentKind, string> = {
  codex: "codex", claude_code: "claude", opencode: "opencode", pi: "pi",
};
export function isAgentKind(kind: string): kind is AgentKind {
  return AGENT_KINDS.includes(kind as AgentKind);
}

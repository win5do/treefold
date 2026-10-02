import type { AgentsSettings, AgentInstallation } from "../../../src/renderer/src/domain/types.ts";

export function createAgentSettings(): AgentsSettings {
  return {
    order: ["codex", "claude_code", "opencode", "pi"],
    codex: { command: "codex --dangerously-bypass-approvals-and-sandbox --model gpt-5.4" },
    claude_code: { command: "" },
    opencode: { command: "" },
    pi: { command: "" },
  };
}
export function createAgentInstallations(): AgentInstallation[] {
  return [
    { kind: "codex", name: "Codex", available: true, executable: "/fixture/bin/codex", version: "codex-cli 1.2.3" },
    { kind: "claude_code", name: "Claude Code", available: false },
    { kind: "opencode", name: "OpenCode", available: false },
    { kind: "pi", name: "Pi", available: false },
  ];
}

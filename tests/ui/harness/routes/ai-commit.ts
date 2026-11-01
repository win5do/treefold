import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteDependencies } from "../types.ts";

export function createAiCommitRoutes({ sendJson }: RouteDependencies) {
  return {
    async handle(
      request: IncomingMessage,
      response: ServerResponse,
      pathname: string,
    ) {
      if (request.method !== "GET" || pathname !== "/api/ai-commit/presets")
        return false;
      sendJson(response, 200, [
        {
          kind: "codex",
          command:
            "codex exec --ephemeral --skip-git-repo-check --sandbox read-only -c model_reasoning_effort=low -",
        },
        { kind: "claude_code", command: "claude -p --tools '' --effort low" },
        { kind: "opencode", command: "opencode run --format json" },
        { kind: "pi", command: "pi --print --no-session --thinking low" },
      ]);
      return true;
    },
  };
}

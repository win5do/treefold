import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteDependencies } from "../types.ts";
import type { AgentKind, Session } from "../../../../src/renderer/src/domain/types.ts";
import { FIXTURE_IDS } from "../../fixtures/sidebar-core.ts";

export function createAgentReviewRoutes({ fixture, readJson, sendJson }: RouteDependencies) {
  let sequence = 0;
  return {
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string) {
      const match = /^\/api\/workspaces\/([^/]+)\/agent-review$/.exec(pathname);
      if (!match) return false;
      const workspace = fixture.workspaceDetails[match[1]];
      if (!workspace || workspace.status !== "active") { sendJson(response, 400, { error: "Workspace is unavailable" }); return true; }
      if (request.method === "GET") {
        sendJson(response, 200, { repositories: workspace.repositories.filter(item => item.access_mode === "read_write").map(item => ({
          repository_id: item.id, name: item.repository_name,
          current_path: item.checkout_path, current_branch: item.branch, current_head: "a".repeat(40),
          target_path: item.source_root, target_branch: workspace.kind === "fork" ? "feature/parent" : "main",
          target_head: "b".repeat(40), merge_base: "c".repeat(40),
        })) });
        return true;
      }
      if (request.method !== "POST") return false;
      const input = await readJson<{ kind: AgentKind; prompt: string; project_directory_id: string }>(request);
      const directory = workspace.workspace_directories.find(item => item.project_directory_id === input.project_directory_id);
      const template = fixture.workspaceDetails[FIXTURE_IDS.workspace].sessions.find(item => item.id === FIXTURE_IDS.workspaceCodex)!;
      const session: Session = { ...template, id: `review-session-${++sequence}`, workspace_id: workspace.id,
        kind: input.kind, name: "AI Review", name_is_custom: true,
        cwd: directory?.path ?? workspace.checkout_path, original_cwd: directory?.path ?? workspace.checkout_path,
        initial_prompt: input.prompt, status: "stopped", agent_session_id: "fixture-review-native-id",
      };
      workspace.sessions.push(session);
      sendJson(response, 201, session);
      return true;
    },
  };
}

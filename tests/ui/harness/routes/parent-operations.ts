import type { ParentOperation, Session } from "../../../../src/renderer/src/domain/types.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteDependencies } from "../types.ts";
import { FIXTURE_IDS } from "../../fixtures/sidebar-core.ts";

const operationTimestamp = "2026-08-10T08:00:00.000Z";
const targetPath = "/tmp/treefold-ui-fixture/worktrees/workspace-ui-fixture";

export function createParentOperationRoutes({ fixture, readJson, sendJson }: RouteDependencies) {
  const requests: string[] = [];
  const operations = new Map<string, ParentOperation>();

  return {
    requests,
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string) {
      const previewMatch = pathname.match(
        /^\/api\/workspace-repositories\/([^/]+)\/parent-operation$/,
      );
      if (previewMatch) {
        const direction = new URL(
          request.url ?? "/",
          "http://fixture.test",
        ).searchParams.get("direction");
        const locationId = previewMatch[1];
        const location = Object.values(fixture.workspaceDetails)
          .flatMap((detail) => detail.repositories)
          .find((item) => item.id === locationId);
        const operation = operations.get(`${locationId}:${direction}`);
        if (request.method === "GET") {
          requests.push(`GET ${locationId}:${direction}`);
          sendJson(response, 200, {
            direction: direction as ParentOperation["direction"],
            repository_name: location?.repository_name ?? "fixture-repository",
            source_path: location?.checkout_path ?? "/tmp/source",
            source_branch: location?.branch ?? "feature/ui-fixture",
            target_scope:
              direction === "integrate" ? "parent_workspace" : "workspace",
            target_path:
              direction === "integrate"
                ? targetPath
                : (location?.checkout_path ?? "/tmp/source"),
            target_branch:
              direction === "integrate"
                ? "treefold/w-ui-fixture"
                : (location?.branch ?? "feature/ui-fixture"),
            source_head: "1111111111111111111111111111111111111111",
            parent_head: "2222222222222222222222222222222222222222",
            outcome:
              direction === "integrate" ? "merge_commit" : "fast_forward",
            blockers: [],
            operation,
          });
          return true;
        }
        if (request.method === "POST") {
          const input = await readJson<{ strategy: ParentOperation["strategy"] }>(request);
          const created: ParentOperation = {
            id: `parent-${direction}-${locationId}`,
            workspace_repository_id: locationId,
            workspace_id: location?.workspace_id ?? FIXTURE_IDS.workspace,
            direction: direction as ParentOperation["direction"],
            strategy: input.strategy,
            origin: "standalone",
            source_repository_id: FIXTURE_IDS.primaryRepository,
            source_path: location?.checkout_path ?? "/tmp/source",
            source_branch: location?.branch ?? "feature/ui-fixture",
            target_scope:
              direction === "integrate" ? "parent_workspace" : "workspace",
            target_workspace_id: FIXTURE_IDS.workspace,
            target_path:
              direction === "integrate"
                ? targetPath
                : (location?.checkout_path ?? "/tmp/source"),
            target_branch:
              direction === "integrate"
                ? "treefold/w-ui-fixture"
                : (location?.branch ?? "feature/ui-fixture"),
            source_head: "1111111111111111111111111111111111111111",
            parent_head: "2222222222222222222222222222222222222222",
            before_head: "1111111111111111111111111111111111111111",
            result_head:
              direction === "integrate"
                ? "3333333333333333333333333333333333333333"
                : undefined,
            recovery_ref: `refs/treefold/recovery/${direction}-${locationId}`,
            status: direction === "update" ? "conflicted" : "completed",
            phase: direction === "update" ? "conflicted" : "completed",
            error:
              direction === "update" ? "Git has unresolved conflicts" : "",
            started_at: operationTimestamp,
            updated_at: operationTimestamp,
            completed_at:
              direction === "integrate" ? operationTimestamp : undefined,
          };
          operations.set(`${locationId}:${direction}`, created);
          requests.push(`POST ${locationId}:${direction}:${input.strategy}`);
          sendJson(response, 200, created);
          return true;
        }
      }

      const operationMatch = pathname.match(
        /^\/api\/parent-operations\/([^/]+)$/,
      );
      if (request.method === "GET" && operationMatch) {
        const operation = [...operations.values()].find(
          (item) => item.id === operationMatch[1],
        );
        if (!operation) {
          sendJson(response, 404, { error: "Parent operation not found" });
          return true;
        }
        sendJson(response, 200, operation);
        return true;
      }

      const actionMatch = pathname.match(
        /^\/api\/parent-operations\/([^/]+)\/(resolve-with-agent|abort)$/,
      );
      if (request.method !== "POST" || !actionMatch) return false;

      const operation = [...operations.values()].find(
        (item) => item.id === actionMatch[1],
      );
      if (!operation) {
        sendJson(response, 404, { error: "Parent operation not found" });
        return true;
      }
      const action = actionMatch[2];
      requests.push(`POST ${operation.id}:${action}`);
      if (action === "resolve-with-agent") {
        const session: Session = {
          id: "parent-resolver-session-ui-fixture",
          workspace_id:
            operation.target_workspace_id ?? operation.workspace_id,
          name: "Resolve parent operation",
          kind: (new URL(request.url!, "http://fixture").searchParams.get("agent_kind") ?? "codex") as Session["kind"],
          cwd: operation.target_path,
          original_cwd: operation.target_path,
          initial_prompt: "Resolve fixed parent operation",
          agent_session_id: "codex-parent-resolver-ui-fixture",
          visibility: "visible",
          amux_workspace_name: "treefold-parent-resolver",
          amux_process_name: "parent-resolver-session-ui-fixture",
          status: "running",
          argv: ["codex"],
          io_mode: "tty",
          launch_started_at: operationTimestamp,
          created_at: operationTimestamp,
          updated_at: operationTimestamp,
        };
        requests.push(`AGENT ${session.kind}`);
        fixture.workspaceDetails[FIXTURE_IDS.workspace].sessions.push(session);
        operation.status = "resolving";
        operation.phase = "resolving";
        operation.resolver_session_id = session.id;
        sendJson(response, 201, session);
        return true;
      }
      operation.status = "aborted";
      operation.phase = operation.status;
      sendJson(response, 200, operation);
      return true;
    },
  };
}

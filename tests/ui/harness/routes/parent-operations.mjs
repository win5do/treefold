import { FIXTURE_IDS } from "../../fixtures/sidebar-core.mjs";

const operationTimestamp = "2026-08-10T08:00:00.000Z";
const targetPath = "/tmp/treefold-ui-fixture/worktrees/workspace-ui-fixture";

export function createParentOperationRoutes({ fixture, readJson, sendJson }) {
  const requests = [];
  const operations = new Map();

  return {
    requests,
    async handle(request, response, pathname) {
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
          .flatMap((detail) => detail.repositories ?? detail.locations)
          .find((item) => item.id === locationId);
        const operation = operations.get(`${locationId}:${direction}`);
        if (request.method === "GET") {
          requests.push(`GET ${locationId}:${direction}`);
          sendJson(response, 200, {
            direction,
            repository_name: location?.location_name ?? "fixture-repository",
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
          const input = await readJson(request);
          const created = {
            id: `parent-${direction}-${locationId}`,
            workspace_repository_id: locationId,
            workspace_id: location?.workspace_id ?? FIXTURE_IDS.workspace,
            direction,
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
            undo_available: direction === "integrate",
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
        /^\/api\/parent-operations\/([^/]+)\/(resolve-with-codex|abort|undo)$/,
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
      if (action === "resolve-with-codex") {
        const session = {
          id: "parent-resolver-session-ui-fixture",
          workspace_id:
            operation.target_workspace_id ?? operation.workspace_id,
          name: "Resolve parent operation",
          kind: "codex",
          cwd: operation.target_path,
          original_cwd: operation.target_path,
          initial_prompt: "Resolve fixed parent operation",
          codex_session_id: "codex-parent-resolver-ui-fixture",
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
        fixture.workspaceDetails[FIXTURE_IDS.workspace].sessions.push(session);
        operation.status = "resolving";
        operation.phase = "resolving";
        operation.resolver_session_id = session.id;
        sendJson(response, 201, session);
        return true;
      }
      operation.status = action === "abort" ? "aborted" : "undone";
      operation.phase = operation.status;
      operation.undo_available = false;
      sendJson(response, 200, operation);
      return true;
    },
  };
}

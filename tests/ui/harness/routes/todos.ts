import type { AgentKind, Todo } from "../../../../src/renderer/src/domain/types.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteDependencies } from "../types.ts";
import { FIXTURE_IDS } from "../../fixtures/sidebar-core.ts";

export function createTodoRoutes({ fixture, readJson, sendJson }: RouteDependencies) {
  const requests: ({ action: string; id: string; forkId?: string; agentKind?: AgentKind } & Partial<Todo>)[] = [];

  return {
    requests,
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string) {
      const workspaceMatch = pathname.match(
        /^\/api\/workspaces\/([^/]+)\/todos$/,
      );
      if (request.method === "POST" && workspaceMatch) {
        const input = await readJson<Pick<Todo, "content">>(request);
        const todo: Todo = {
          id: `todo-created-${fixture.workspaceDetails[workspaceMatch[1]].todos.length}`,
          workspace_id: workspaceMatch[1],
          content: input.content,
          status: "pending",
        };
        fixture.workspaceDetails[workspaceMatch[1]].todos.unshift(todo);
        requests.push({ action: "create", id: todo.id, content: input.content });
        sendJson(response, 201, todo);
        return true;
      }

      const todoMatch = pathname.match(/^\/api\/todos\/([^/]+)$/);
      const owner = Object.values(fixture.workspaceDetails).find((detail) =>
        detail.todos.some((todo) => todo.id === todoMatch?.[1]),
      );
      const todo = owner?.todos.find((item) => item.id === todoMatch?.[1]);
      if (request.method === "PATCH" && todoMatch && todo) {
        const input = await readJson<Partial<Pick<Todo, "content" | "status">>>(request);
        if (input.content !== undefined) todo.content = input.content;
        if (input.status !== undefined) todo.status = input.status;
        requests.push({ action: "update", id: todo.id, ...input });
        sendJson(response, 200, todo);
        return true;
      }
      if (request.method === "DELETE" && todoMatch && todo && owner) {
        owner.todos = owner.todos.filter((item) => item.id !== todo.id);
        requests.push({ action: "delete", id: todo.id });
        sendJson(response, 204, null);
        return true;
      }

      const forkMatch = pathname.match(/^\/api\/todos\/([^/]+)\/fork$/);
      const forkOwner = Object.values(fixture.workspaceDetails).find((detail) =>
        detail.todos.some((item) => item.id === forkMatch?.[1]),
      );
      const forkTodo = forkOwner?.todos.find(
        (item) => item.id === forkMatch?.[1],
      );
      if (request.method === "POST" && forkMatch && forkTodo) {
        const fork = fixture.workspaceDetails[FIXTURE_IDS.fork];
        const agentKind = (new URL(request.url!, "http://fixture").searchParams.get("agent_kind") ?? "codex") as AgentKind;
        const session = { ...fork.sessions[0], kind: agentKind };
        forkTodo.status = "in_progress";
        forkTodo.fork_id = fork.id;
        requests.push({ action: "fork", id: forkTodo.id, forkId: fork.id, agentKind });
        sendJson(response, 201, { fork, session });
        return true;
      }

      return false;
    },
  };
}

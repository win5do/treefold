import type { AgentIntegrationState } from "../../../../src/renderer/src/domain/types.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteDependencies } from "../types.ts";
export function createAgentIntegrationRoutes({ fixture, sendJson }: Pick<RouteDependencies, "fixture" | "sendJson">) {
  const requests: string[] = [];
  const setManagedState = (state: AgentIntegrationState) => {
    fixture.agentIntegration.state = state;
    for (const component of fixture.agentIntegration.components) {
      if (component.install_path) component.state = state === "ready" ? "ready" : "not_installed";
    }
  };
  return {
    requests,
    setState: setManagedState,
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string) {
      if (pathname !== "/api/agent-integration") return false;
      if (request.method === "GET") {
        sendJson(response, 200, fixture.agentIntegration);
        return true;
      }
      if (request.method === "POST") {
        requests.push("sync");
        setManagedState("ready");
        sendJson(response, 200, fixture.agentIntegration);
        return true;
      }
      if (request.method === "DELETE") {
        requests.push("uninstall");
        setManagedState("not_installed");
        sendJson(response, 200, fixture.agentIntegration);
        return true;
      }
      return false;
    },
  };
}

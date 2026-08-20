export function createAgentIntegrationRoutes({ fixture, sendJson }) {
  const requests = [];
  const setManagedState = (state) => {
    fixture.agentIntegration.state = state;
    for (const component of fixture.agentIntegration.components) {
      if (component.install_path) component.state = state === "ready" ? "ready" : "not_installed";
    }
  };
  return {
    requests,
    setState: setManagedState,
    async handle(request, response, pathname) {
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

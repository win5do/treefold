import type { IncomingMessage, ServerResponse } from "node:http";
import type { AmuxStatus } from "../../../../src/renderer/src/domain/types.ts";
import type { RouteDependencies } from "../types.ts";

export function createResourcesRoutes({ fixture, sendJson }: RouteDependencies, publish: (domains: string[]) => void) {
  const stopRequests: string[] = [];
  const recoverRequests: string[] = [];
  let recoveryError: string | undefined;
  return {
    stopRequests, recoverRequests,
    setStatus(status: Partial<AmuxStatus>) { Object.assign(fixture.amux, status); publish(["amux"]); },
    failNextRecovery(message: string) { recoveryError = message; },
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string) {
      if (request.method === "GET" && pathname === "/api/amux") {
        sendJson(response, 200, fixture.amux); return true;
      }
      if (request.method !== "POST" || !["/api/amux/stop", "/api/amux/recover"].includes(pathname)) return false;
      const recovering = pathname.endsWith("/recover");
      (recovering ? recoverRequests : stopRequests).push(pathname);
      if (recovering && recoveryError) {
        sendJson(response, 409, { error: { code: "AMUX_RECOVERY_FAILED", message: recoveryError } });
        recoveryError = undefined; return true;
      }
      fixture.amux.running = recovering;
      fixture.amux.state = recovering ? "healthy" : "stopped";
      fixture.amux.recovery_available = false;
      fixture.amux.started_at = recovering ? new Date().toISOString() : undefined;
      fixture.amux.active_groups = 0;
      fixture.amux.active_processes = 0;
      for (const detail of Object.values(fixture.workspaceDetails)) {
        for (const session of detail.sessions) if (session.status === "running") session.status = "stopped";
      }
      sendJson(response, 204, null);
      publish(["sidebar", "sessions", "processes", "amux"]);
      return true;
    },
  };
}

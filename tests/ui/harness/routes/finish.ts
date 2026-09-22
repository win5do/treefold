import type { IncomingMessage, ServerResponse } from "node:http";
import { FIXTURE_IDS } from "../../fixtures/sidebar-core.ts";
import type { RouteDependencies } from "../types.ts";

export function createFinishRoutes({
  fixture,
  readJson,
  sendJson,
}: RouteDependencies) {
  const preflights: typeof fixture.deliveryPreflights = {
    ...fixture.deliveryPreflights,
    [FIXTURE_IDS.forkSecondaryLocation]: {
      ...fixture.deliveryPreflights[FIXTURE_IDS.forkPrimaryLocation],
      id: "delivery-preflight-fork-secondary-ui-fixture",
      workspace_repository_id: FIXTURE_IDS.forkSecondaryLocation,
    },
  };
  return {
    async handle(
      request: IncomingMessage,
      response: ServerResponse,
      pathname: string,
    ) {
      if (
        request.method === "GET" &&
        /^\/api\/workspaces\/[^/]+\/finish-batch$/.test(pathname)
      ) {
        sendJson(response, 200, null);
        return true;
      }
      const preflight = pathname.match(
        /^\/api\/workspace-repositories\/([^/]+)\/delivery-preflight$/,
      );
      if (request.method === "POST" && preflight && preflights[preflight[1]]) {
        const input = await readJson<{ code_action: string }>(request);
        sendJson(response, 201, {
          ...preflights[preflight[1]],
          code_action: input.code_action,
        });
        return true;
      }
      return false;
    },
  };
}

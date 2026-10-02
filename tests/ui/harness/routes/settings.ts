import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppSettings, AgentsSettingsPatch, AgentKind } from "../../../../src/renderer/src/domain/types.ts";
import type { RouteDependencies } from "../types.ts";
import { createAgentSettings } from "../../fixtures/agents.ts";

export function createSettingsRoutes({ fixture, readJson, sendJson }: RouteDependencies) {
  return {
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string) {
      if (pathname !== "/api/settings") return false;
      if (request.method === "GET") { sendJson(response, 200, fixture.settings); return true; }
      if (request.method !== "PATCH") return false;
      const input = await readJson<Omit<Partial<AppSettings>, "agents"> & { agents?: AgentsSettingsPatch; reset?: string[] }>(request);
      await new Promise<void>(resolve => setTimeout(resolve, 150));
      if (Object.keys(input).some(key => !["reset", "language", "theme", "agents", "amux"].includes(key))) {
        sendJson(response, 400, { error: "Unknown settings field" }); return true;
      }
      for (const key of input.reset ?? []) {
        if (key === "language") fixture.settings.language = "system";
        if (key === "theme") fixture.settings.theme = "system";
        if (key === "agents.order") fixture.settings.agents.order = createAgentSettings().order;
        const match = /^agents\.(codex|claude_code|opencode|pi)\.(command)$/.exec(key);
        if (match) fixture.settings.agents[match[1] as AgentKind][match[2] as "command"] = "";
        if (key === "amux.keep_daemon_running_on_exit") fixture.settings.amux.keep_daemon_running_on_exit = false;
      }
      if (input.language !== undefined) fixture.settings.language = input.language;
      if (input.theme !== undefined) fixture.settings.theme = input.theme;
      if (input.agents) {
        if (input.agents.order) fixture.settings.agents.order = input.agents.order;
        for (const kind of createAgentSettings().order) {
          Object.assign(fixture.settings.agents[kind], input.agents[kind]);
        }
      }
      if (input.amux?.keep_daemon_running_on_exit !== undefined) fixture.settings.amux.keep_daemon_running_on_exit = input.amux.keep_daemon_running_on_exit;
      sendJson(response, 200, fixture.settings);
      return true;
    },
  };
}

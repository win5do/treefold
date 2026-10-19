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
      if (Object.keys(input).some(key => !["reset", "language", "theme", "close_behavior", "agents", "amux", "updates", "projects"].includes(key))) {
        sendJson(response, 400, { error: "Unknown settings field" }); return true;
      }
      for (const key of input.reset ?? []) {
        if (key === "language") fixture.settings.language = "system";
        if (key === "theme") fixture.settings.theme = "system";
        if (key === "close_behavior") fixture.settings.close_behavior = "hide_to_tray";
        if (key === "updates.skipped_version") fixture.settings.updates.skipped_version = null;
        if (key === "updates.remind_after") fixture.settings.updates.remind_after = null;
        if (key === "agents.order") fixture.settings.agents.order = createAgentSettings().order;
        const match = /^agents\.(codex|claude_code|opencode|pi)\.(command)$/.exec(key);
        if (match) fixture.settings.agents[match[1] as AgentKind][match[2] as "command"] = "";
        if (key === "amux.keep_daemon_running_on_exit") fixture.settings.amux.keep_daemon_running_on_exit = false;
      }
      if (input.language !== undefined) fixture.settings.language = input.language;
      if (input.projects) {
        fixture.settings.projects ??= {};
        for (const [id, project] of Object.entries(input.projects)) {
          fixture.settings.projects[id] = { review_prompt: project.review_prompt.trim() ? project.review_prompt : "" };
        }
      }
      if (input.theme !== undefined) fixture.settings.theme = input.theme;
      if (input.close_behavior !== undefined) fixture.settings.close_behavior = input.close_behavior;
      if (input.updates) Object.assign(fixture.settings.updates, input.updates);
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

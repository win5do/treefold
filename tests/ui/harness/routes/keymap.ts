import type { IncomingMessage, ServerResponse } from "node:http";
import type { ReadJson, SendJson } from "../types.ts";
import type { Keymap } from "../../../../src/renderer/src/domain/types.ts";
export function createKeymapRoutes({
  readJson,
  sendJson,
}: {
  readJson: ReadJson;
  sendJson: SendJson;
}) {
  const defaults: [string, string, string][] = [
    ["session.new", "New Session", "super+t"],
    ["session.close", "Close Session", "super+w"],
    ["session.next", "Next Session", "ctrl+tab"],
    ["session.previous", "Previous Session", "ctrl+shift+tab"],
  ];
  const overrides: Record<string, string | false> = {};
  const snapshot = () =>
    ({
      schema_version: 1,
      commands: defaults.map(([id, label, default_binding]) => ({
        id,
        label,
        default_binding,
        binding: overrides[id] ?? default_binding,
        source: id in overrides ? "user" : "default",
      })),
    }) as Keymap;
  return {
    async handle(
      request: IncomingMessage,
      response: ServerResponse,
      pathname: string,
    ) {
      if (pathname !== "/api/keymap") return false;
      if (request.method === "GET") {
        sendJson(response, 200, snapshot());
        return true;
      }
      if (request.method !== "PATCH") return false;
      const input = await readJson<{
        bindings: Record<string, string | false | null>;
      }>(request);
      const next = { ...overrides };
      for (const [id, binding] of Object.entries(input.bindings)) {
        if (binding === null) delete next[id];
        else
          next[id] =
            typeof binding === "string"
              ? binding.replace(/^(cmd|command|win|meta)\+/, "super+")
              : binding;
      }
      const chords = defaults
        .map(([id, , fallback]) => next[id] ?? fallback)
        .filter((value) => value !== false);
      if (new Set(chords).size !== chords.length) {
        sendJson(response, 400, {
          error: {
            code: "BAD_REQUEST",
            message: "shortcut conflicts with another command",
          },
        });
        return true;
      }
      for (const id of Object.keys(overrides)) delete overrides[id];
      Object.assign(overrides, next);
      sendJson(response, 200, snapshot());
      return true;
    },
  };
}

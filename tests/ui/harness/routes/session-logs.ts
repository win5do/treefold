import type { IncomingMessage, ServerResponse } from "node:http";
import { fixtureSessions } from "../../fixtures/sessions.ts";
import type { RouteDependencies } from "../types.ts";

// A finite retained-log response keeps ordinary navigation deterministic. Tests
// for live output provide their own sequence of records in pipe-logs.spec.ts.
export function createSessionLogRoutes({ fixture }: Pick<RouteDependencies, "fixture">) {
  return {
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string) {
      const match = pathname.match(/^\/api\/sessions\/([^/]+)\/logs$/);
      if (request.method !== "GET" || !match) return false;
      const session = fixtureSessions(fixture).find(item => item.id === match[1]);
      // Unconfigured Sessions and TTY log requests must still be recorded as unexpected.
      if (!session || session.io_mode !== "pipe") return false;
      const url = new URL(request.url!, "http://fixture.test");
      const cursor = url.searchParams.get("after") ?? "0";
      if (!/^\d+$/.test(cursor)) return false;
      const after = BigInt(cursor);
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/x-ndjson",
      });
      response.end(after < 1n ? JSON.stringify({
        sequence: 1, execution: 1, stream: "stdout",
        data: { encoding: "utf8", text: `${session.name} ready\n` },
      }) + "\n" : "");
      return true;
    },
  };
}

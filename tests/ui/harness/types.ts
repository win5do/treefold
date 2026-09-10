import type { IncomingMessage, ServerResponse } from "node:http";
import type { SidebarFixture } from "../fixtures/types.ts";

export type ReadJson = <T>(request: IncomingMessage) => Promise<T>;
export type SendJson = (response: ServerResponse, status: number, value: unknown) => void;
export interface RouteDependencies {
  fixture: SidebarFixture;
  readJson: ReadJson;
  sendJson: SendJson;
}

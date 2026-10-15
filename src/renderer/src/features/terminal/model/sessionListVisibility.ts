import { isAgentKind } from "@/features/agents/model";
import type { Session } from "@/domain/types";

export function isSessionListed(session: Session): boolean {
  return !isAgentKind(session.kind)
    || Boolean(session.initializing)
    || session.status === "running"
    || Boolean(session.agent_session_id?.trim());
}

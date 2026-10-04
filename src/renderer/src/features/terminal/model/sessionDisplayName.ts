import type { Session } from "@/domain/types";
import { AGENT_NAMES } from "@/features/agents/model";

/** Names stay editable; terminal titles are a separate, persisted observation. */
export function sessionDisplayName(session: Session): string {
  const defaultName = AGENT_NAMES[session.kind as keyof typeof AGENT_NAMES] ?? session.kind;
  const custom = session.name_is_custom ?? session.name !== defaultName;
  if (custom) return session.name;
  return session.terminal_title?.trim() || `${session.name} · ${session.id.slice(-8)}`;
}

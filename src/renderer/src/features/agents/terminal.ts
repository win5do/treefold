import type { Session } from "@/domain/types";
import { codexTerminal } from "./implementations/codex";

export function agentShiftEnter(kind: Session["kind"]): string | undefined {
  return kind === "codex" ? codexTerminal.shiftEnter : undefined;
}

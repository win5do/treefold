import type { KeyboardEvent } from "react";
import type { AgentKind, Directory } from "@/domain/types";

export function handleSessionChoiceKeyboard(event: KeyboardEvent<HTMLDivElement>, options: {
  directories: Directory[];
  directoryId?: string;
  agentKinds: AgentKind[];
  agentKind?: AgentKind;
  directoryRefs: Map<string, HTMLButtonElement>;
  agentRefs: Map<AgentKind, HTMLSpanElement>;
  selectAgent: (kind: AgentKind) => void;
  submit: () => void;
  disabled?: boolean;
}) {
  if (event.nativeEvent.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const group = event.target instanceof HTMLElement
    ? event.target.closest("[data-session-choice]")?.getAttribute("data-session-choice") : null;
  if (!group || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"].includes(event.key)) return;
  // Capture navigation before the radio controls interpret Left/Right. Inputs
  // outside these selection groups keep their native editing behavior.
  event.preventDefault();
  event.stopPropagation();
  if (options.disabled) return;
  if (event.key === "Enter") { if (!event.repeat) options.submit(); return; }
  const focusDirectory = () => { if (options.directoryId) options.directoryRefs.get(options.directoryId)?.focus(); };
  if (event.key === "ArrowLeft") {
    if (group === "agent") focusDirectory();
    return;
  }
  if (event.key === "ArrowRight") {
    if (group === "type") focusDirectory();
    else if (group === "directory" && options.agentKind) options.agentRefs.get(options.agentKind)?.focus();
    return;
  }
  const step = event.key === "ArrowDown" ? 1 : -1;
  if ((group === "type" || group === "directory") && options.directories.length) {
    const index = options.directories.findIndex(item => item.id === options.directoryId);
    options.directoryRefs.get(options.directories[(index + step + options.directories.length) % options.directories.length].id)?.focus();
  } else if (group === "agent" && options.agentKinds.length) {
    const index = options.agentKinds.indexOf(options.agentKind!);
    const next = options.agentKinds[(index + step + options.agentKinds.length) % options.agentKinds.length];
    options.selectAgent(next);
    options.agentRefs.get(next)?.focus();
  }
}

import { useAgentChoice } from "@/features/agents/AgentSelect";
import { AgentChoices } from "@/features/agents/AgentChoices";
import { SessionDirectoryChoices } from "./SessionDirectoryChoices";
import { handleSessionChoiceKeyboard } from "./sessionChoiceKeyboard";
import { useTranslation } from "react-i18next";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AgentKind, Directory, NewSessionKind } from "@/domain/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function NewSessionDialog({
  name,
  directories,
  initialType = "shell",
  agentOnly = false,
  onClose,
  onCreate,
}: {
  name: string;
  directories: Directory[];
  initialType?: "shell" | "agent";
  agentOnly?: boolean;
  onClose: () => void;
  onCreate: (kind: NewSessionKind, directory: Directory) => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<"shell" | "agent">(initialType);
  const typeRefs = useRef<
    Partial<Record<"shell" | "agent", HTMLButtonElement | null>>
  >({});
  const choice = useAgentChoice();
  const agent = choice.available.find(agent => agent.kind === choice.kind);
  const agentRefs = useRef(new Map<AgentKind, HTMLSpanElement>());
  const directoryRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusDirectoryAfterSwitch = useRef(false);
  const [selected, setSelected] = useState<string | undefined>();
  const available = directories.filter(
    (directory) =>
      kind === "shell" ||
      (directory.is_git && directory.git_status === "ready"),
  );
  const active =
    available.find(
      (directory) => directory.id === selected,
    ) ?? available[0];
  useLayoutEffect(() => {
    if (!focusDirectoryAfterSwitch.current) return;
    focusDirectoryAfterSwitch.current = false;
    // Wait for the new type to update directory availability before focusing.
    const target = active ? directoryRefs.current.get(active.id) : typeRefs.current[kind];
    target?.focus();
  }, [kind, active?.id]);
  const create = () => {
    if (!active) return;
    if (kind === "shell") onCreate("shell", active);
    else if (agent) onCreate(agent.kind, active);
  };
  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      if (!agentOnly) {
        focusDirectoryAfterSwitch.current = true;
        setKind(kind === "shell" ? "agent" : "shell");
      }
      return;
    }
    handleSessionChoiceKeyboard(event, {
      directories: available, directoryId: active?.id,
      agentKinds: choice.available.map(agent => agent.kind), agentKind: kind === "agent" ? choice.kind : undefined,
      directoryRefs: directoryRefs.current, agentRefs: agentRefs.current,
      selectAgent: choice.select, submit: create,
    });
  };
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent onKeyDownCapture={handleKeyboard} initialFocus={() => typeRefs.current[kind] ?? null} className="flex h-[min(36rem,86vh)] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("terminalUi.newSession")}</DialogTitle>
          <DialogDescription>{t("terminalUi.chooseTypeDirectory", { name })}</DialogDescription>
        </DialogHeader>
        <ToggleGroup
          data-session-choice="type"
          className="shrink-0"
          value={[kind]}
          onValueChange={(values) => {
            if (values[0]) setKind(values[0] as "shell" | "agent");
          }}
          aria-label={t("terminalUi.sessionType")}
        >
          <ToggleGroupItem
            ref={(node) => { typeRefs.current.shell = node; }}
            value="shell"
            disabled={agentOnly}
            onFocus={() => setKind("shell")}
          >
            Shell
          </ToggleGroupItem>
          <ToggleGroupItem
            ref={(node) => { typeRefs.current.agent = node; }}
            value="agent"
            onFocus={() => setKind("agent")}
          >
            Agent
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <SessionDirectoryChoices directories={directories} agentOnly={kind === "agent"}
            selectedId={active?.id} onSelect={setSelected}
            itemRef={(id, node) => { if (node) directoryRefs.current.set(id, node); else directoryRefs.current.delete(id); }} />
          {kind === "agent" && <AgentChoices choice={choice}
            itemRef={(kind, node) => { if (node) agentRefs.current.set(kind, node); else agentRefs.current.delete(kind); }} />}
        </div>
        <p className="min-h-10 shrink-0 text-xs text-muted-foreground">{t(agentOnly ? "terminalUi.agentKeyboardHint" : "terminalUi.sessionKeyboardHint")}</p>
        <Button className="shrink-0" disabled={!active || (kind === "agent" && !agent)} onClick={create}>{t("terminalUi.createSession")}</Button>
      </DialogContent>
    </Dialog>
  );
}

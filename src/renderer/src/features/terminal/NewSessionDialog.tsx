import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAgentCatalog } from "@/features/agents/useAgentCatalog";
import { AgentIcon } from "@/features/agents/AgentIcon";
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
import { Field, FieldLabel, FieldSet, FieldLegend, FieldDescription } from "@/components/ui/field";
import { compactPath } from "@/lib/compactPath";
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
  initialType?: "shell" | "codex";
  agentOnly?: boolean;
  onClose: () => void;
  onCreate: (kind: NewSessionKind, directory: Directory) => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<"shell" | "codex">(initialType);
  const typeRefs = useRef<
    Partial<Record<"shell" | "codex", HTMLButtonElement | null>>
  >({});
  const catalog = useAgentCatalog();
  const [chosenAgent, setChosenAgent] = useState<AgentKind | null>(null);
  const availableAgents = catalog.error ? [] : catalog.agents.filter(agent => agent.available);
  const agent = availableAgents.find(agent => agent.kind === chosenAgent) ?? availableAgents[0];
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
    if (active && (kind === "shell" || agent)) onCreate(kind === "shell" ? "shell" : agent.kind, active);
  };
  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      if (!agentOnly) {
        focusDirectoryAfterSwitch.current = true;
        setKind(kind === "shell" ? "codex" : "shell");
      }
      return;
    }
    if (event.shiftKey) return;
    const group = event.target instanceof HTMLElement
      ? event.target.closest("[data-session-choice]")?.getAttribute("data-session-choice")
      : null;
    if (!group || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"].includes(event.key)) return;
    // Own directional navigation here so the underlying radio/toggle controls
    // do not also interpret Left/Right as selecting a different option.
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Enter") { create(); return; }
    const focusDirectory = () => { if (active) directoryRefs.current.get(active.id)?.focus(); };
    if (event.key === "ArrowLeft") {
      if (group === "agent") focusDirectory();
      return;
    }
    if (event.key === "ArrowRight") {
      if (group === "type") focusDirectory();
      else if (group === "directory" && kind === "codex" && agent) agentRefs.current.get(agent.kind)?.focus();
      return;
    }
    const step = event.key === "ArrowDown" ? 1 : -1;
    if (group === "directory" && available.length) {
      const index = available.findIndex(item => item.id === active?.id);
      directoryRefs.current.get(available[(index + step + available.length) % available.length].id)?.focus();
    } else if (group === "agent" && availableAgents.length) {
      const index = availableAgents.findIndex(item => item.kind === agent?.kind);
      const next = availableAgents[(index + step + availableAgents.length) % availableAgents.length];
      setChosenAgent(next.kind);
      agentRefs.current.get(next.kind)?.focus();
    }
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
            if (values[0]) setKind(values[0] as "shell" | "codex");
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
            ref={(node) => { typeRefs.current.codex = node; }}
            value="codex"
            onFocus={() => setKind("codex")}
          >
            Agent
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <FieldSet>
            <FieldLegend>{t("terminalUi.directory")}</FieldLegend>
            <div
              className="flex max-h-64 flex-col gap-1 overflow-y-auto"
              role="group"
              data-session-choice="directory"
              aria-label={t("terminalUi.availableDirectories")}
            >
              {directories.map((directory) => {
                const disabled =
                  kind === "codex" &&
                  (!directory.is_git || directory.git_status !== "ready");
                return (
                  <Button
                    key={directory.id}
                    ref={(node) => {
                      if (node) directoryRefs.current.set(directory.id, node);
                      else directoryRefs.current.delete(directory.id);
                    }}
                    tabIndex={active?.id === directory.id ? 0 : -1}
                    onFocus={() => setSelected(directory.id)}
                    variant={active?.id === directory.id ? "secondary" : "ghost"}
                    className="h-auto justify-start"
                    disabled={disabled}
                    aria-pressed={active?.id === directory.id}
                    onClick={() => setSelected(directory.id)}
                  >
                    <span className="flex min-w-0 flex-col items-start">
                      <span>{directory.name}</span>
                      <span className="max-w-full whitespace-normal break-all text-left text-muted-foreground" title={directory.path}>
                        {compactPath(directory.path)}
                        {disabled ? t("terminalUi.agentsRequireAnAvailableGitDirectory") : ""}
                      </span>
                    </span>
                  </Button>
                );
              })}
              {directories.length === 0 && <p role="status">{t("terminalUi.noDirectories")}</p>}
            </div>
          </FieldSet>
          {kind === "codex" && <FieldSet>
            <FieldLegend>{t("agentsUi.chooseAgent")}</FieldLegend>
            <RadioGroup data-session-choice="agent" aria-label={t("agentsUi.chooseAgent")} value={agent?.kind ?? null} onValueChange={value => setChosenAgent(value as AgentKind)}>
              {availableAgents.map(item => <Field key={item.kind} orientation="horizontal" data-disabled={!item.available || !!catalog.error}>
                <RadioGroupItem ref={node => { if (node) agentRefs.current.set(item.kind, node); else agentRefs.current.delete(item.kind); }} id={`new-session-agent-${item.kind}`} value={item.kind} disabled={!item.available || !!catalog.error} />
                <FieldLabel htmlFor={`new-session-agent-${item.kind}`}><AgentIcon kind={item.kind} className="size-4" />{item.name}{!item.available && !catalog.loading && !catalog.error ? ` · ${t("agentsUi.notInstalled")}` : ""}</FieldLabel>
              </Field>)}
            </RadioGroup>
            {(catalog.loading || catalog.error || !agent) && <FieldDescription role="status">{t(catalog.loading ? "agentsUi.checking" : catalog.error ? "agentsUi.detectionFailed" : "agentsUi.noneInstalled")}</FieldDescription>}
          </FieldSet>}
        </div>
        <p className="min-h-10 shrink-0 text-xs text-muted-foreground">{t(agentOnly ? "terminalUi.agentKeyboardHint" : "terminalUi.sessionKeyboardHint")}</p>
        <Button className="shrink-0" disabled={!active || (kind === "codex" && !agent)} onClick={create}>{t("terminalUi.createSession")}</Button>
      </DialogContent>
    </Dialog>
  );
}

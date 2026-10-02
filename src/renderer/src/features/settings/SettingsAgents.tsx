import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { systemQuery } from "@/features/app/queries";
import { AGENT_EXECUTABLES, AGENT_KINDS, AGENT_NAMES } from "@/features/agents/model";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import type { AgentKind, AgentsSettings, AgentsSettingsPatch, AppSettings } from "@/domain/types";
import type { SettingsFormPatch } from "./useSettingsSave";

export function SettingsAgents({ settings, busy, onSave }: {
  settings: AppSettings | null;
  busy: boolean;
  onSave: (patch: SettingsFormPatch) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const { t } = useTranslation();
  const system = useQuery({ ...systemQuery(), refetchOnMount: "always" });
  const [draft, setDraft] = useState<AgentsSettings | null>(null);
  const [dragging, setDragging] = useState<AgentKind | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseline = useRef<AgentsSettings | null>(null);
  const configured = JSON.stringify(settings?.agents);
  useEffect(() => {
    const next = settings ? structuredClone(settings.agents) : null;
    const previous = baseline.current;
    setDraft(current => {
      if (!current || !previous || !next) return next;
      const merged = structuredClone(current);
      if (JSON.stringify(current.order) === JSON.stringify(previous.order)) merged.order = next.order;
      for (const kind of next.order) {
        if (current[kind].command === previous[kind].command) merged[kind].command = next[kind].command;
      }
      return merged;
    });
    baseline.current = next;
    setError(null);
  }, [configured]);
  if (!draft || !settings) return <p role="status" className="p-6">{t("agentsUi.loading")}</p>;
  const installedOrder = draft.order.filter(kind => !system.error && system.data?.agents.some(agent => agent.kind === kind && agent.available));
  const move = (kind: AgentKind, target: number) => {
    if (busy || saving || target < 0 || target >= installedOrder.length) return;
    const visible = installedOrder.filter(item => item !== kind);
    visible.splice(target, 0, kind);
    const order = [...visible, ...draft.order.filter(item => !installedOrder.includes(item))];
    setDraft({ ...draft, order });
    setError(null);
  };
  const save = async (reset?: AgentKind) => {
    setSaving(true);
    setError(null);
    const changes: AgentsSettingsPatch = {};
    if (JSON.stringify(draft.order) !== JSON.stringify(settings.agents.order)) changes.order = draft.order;
    for (const kind of draft.order) {
      const patch: Partial<AgentsSettings[AgentKind]> = {};
      if (draft[kind].command !== settings.agents[kind].command) patch.command = draft[kind].command;
      if (Object.keys(patch).length) changes[kind] = patch;
    }
    try {
      const result = await onSave(reset
        ? { reset: [`agents.${reset}.command`] }
        : { agents: changes });
      if (result.ok) {
        if (reset) setDraft(current => current && { ...current, [reset]: { command: "" } });
        toast.success(t("settings.saved"));
      }
      else setError(result.error);
    } finally { setSaving(false); }
  };
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      <section aria-labelledby="agent-order-title" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id="agent-order-title" className="text-sm font-medium">{t("agentsUi.order")}</h3>
          <Button variant="ghost" size="icon-sm" aria-label={t("agentsUi.refresh")} title={t("agentsUi.refresh")}
            disabled={system.isFetching || busy || saving} aria-busy={system.isFetching}
            onClick={() => void system.refetch()}>
            <RefreshCw data-icon="inline-start" className={cn(system.isFetching && "animate-spin")} />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t("agentsUi.orderHint")}</p>
        <ol aria-label={t("agentsUi.order")} className="flex flex-col gap-2">
          {installedOrder.map((kind, index) => <li key={kind} data-testid={`agent-row-${kind}`} className="flex items-center gap-3 rounded-md border p-2"
            onDragOver={event => { if (dragging) event.preventDefault(); }}
            onDrop={event => {
              event.preventDefault();
              if (dragging && event.dataTransfer.getData("application/x-treefold-agent") === dragging) move(dragging, index);
              setDragging(null);
            }}>
            <Button variant="ghost" size="icon-sm" draggable={!busy && !saving} disabled={busy || saving}
              aria-label={t("agentsUi.drag", { name: AGENT_NAMES[kind] })}
              onDragStart={event => { setDragging(kind); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-treefold-agent", kind); }}
              onDragEnd={() => setDragging(null)}><GripVertical data-icon="inline-start" /></Button>
            <span className="min-w-0 flex-1 text-sm">{AGENT_NAMES[kind]}</span>
            <Button variant="ghost" size="icon-sm" aria-label={t("agentsUi.moveUp", { name: AGENT_NAMES[kind] })} disabled={busy || saving || index === 0} onClick={() => move(kind, index - 1)}><ArrowUp data-icon="inline-start" /></Button>
            <Button variant="ghost" size="icon-sm" aria-label={t("agentsUi.moveDown", { name: AGENT_NAMES[kind] })} disabled={busy || saving || index === installedOrder.length - 1} onClick={() => move(kind, index + 1)}><ArrowDown data-icon="inline-start" /></Button>
          </li>)}
        </ol>
        {(system.isPending || system.error || !installedOrder.length) && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{t(system.isPending ? "agentsUi.checking" : system.error ? "agentsUi.detectionFailed" : "agentsUi.noneInstalled")}</p>}
      </section>
      <Separator />
      <p className="text-sm text-muted-foreground">{t("agentsUi.description")}</p>
      <div className="flex flex-col gap-3">
        {AGENT_KINDS.map(kind => {
          const installation = system.data?.agents.find(agent => agent.kind === kind);
          return <Collapsible key={kind} className="rounded-md border">
            <CollapsibleTrigger render={<Button variant="ghost" className="h-auto w-full justify-between gap-3 px-4 py-3" />}
              aria-label={t("agentsUi.configure", { name: AGENT_NAMES[kind] })}>
              <span>{AGENT_NAMES[kind]}</span>
              <Badge variant={system.isPending || system.error ? "secondary" : installation?.available ? "success" : "destructive"} className="ml-auto max-w-64 whitespace-normal break-all">{system.isPending ? t("agentsUi.checking") : system.error ? t("agentsUi.detectionFailed") : installation?.available ? installation.version || t("agentsUi.versionUnknown") : t("agentsUi.notInstalled")}</Badge>
              <ChevronDown data-icon="inline-end" />
            </CollapsibleTrigger>
            <CollapsibleContent keepMounted>
              <FieldGroup className="border-t p-4">
                <Field data-invalid={!!error}>
                  <FieldLabel htmlFor={`agent-command-${kind}`}>{t("agentsUi.command", { name: AGENT_NAMES[kind] })}</FieldLabel>
                  <Textarea id={`agent-command-${kind}`} rows={3} aria-invalid={!!error} value={draft[kind].command} placeholder={AGENT_EXECUTABLES[kind]} disabled={busy || saving}
                    onChange={event => { setDraft({ ...draft, [kind]: { command: event.target.value } }); setError(null); }} />
                  <FieldDescription>{t("agentsUi.commandHint")}</FieldDescription>
                </Field>
                <div className="flex justify-end">
                  <Button variant="ghost" disabled={busy || saving} onClick={() => void save(kind)}>{t("agentsUi.resetAgent", { name: AGENT_NAMES[kind] })}</Button>
                </div>
              </FieldGroup>
            </CollapsibleContent>
          </Collapsible>;
        })}
      </div>
    </div>
    <Separator />
    <div className="flex min-h-16 shrink-0 items-center justify-end gap-3 px-6 py-3">
      {error && <FieldError role="alert">{error}</FieldError>}
      <Button disabled={busy || saving} onClick={() => void save()}>{t(saving ? "settings.saving" : "common.save")}</Button>
    </div>
  </div>;
}

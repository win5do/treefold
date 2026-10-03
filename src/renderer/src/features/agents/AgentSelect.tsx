import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { AgentKind } from "@/domain/types";
import { useAgentCatalog } from "./useAgentCatalog";

export function useAgentChoice() {
  const catalog = useAgentCatalog();
  const [selected, select] = useState<AgentKind>();
  const available = catalog.error ? [] : catalog.agents.filter(agent => agent.available);
  const kind = available.find(agent => agent.kind === selected)?.kind ?? available[0]?.kind;
  return { ...catalog, available, kind, select };
}

export function AgentSelect({ choice, disabled }: { choice: ReturnType<typeof useAgentChoice>; disabled?: boolean }) {
  const { t } = useTranslation();
  return <Field className="w-auto min-w-0">
    <FieldLabel className="sr-only">{t("agentsUi.chooseAgent")}</FieldLabel>
    <NativeSelect className="max-w-48" aria-label={t("agentsUi.chooseAgent")} value={choice.kind ?? ""}
      disabled={disabled || !choice.kind} onChange={event => choice.select(event.target.value as AgentKind)}>
      {!choice.kind && <NativeSelectOption value="">{t(choice.loading ? "agentsUi.checking" : choice.error ? "agentsUi.detectionFailed" : "agentsUi.noneAvailable")}</NativeSelectOption>}
      {choice.available.map(agent => <NativeSelectOption key={agent.kind} value={agent.kind}>{agent.name}</NativeSelectOption>)}
    </NativeSelect>
  </Field>;
}

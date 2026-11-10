import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, FieldLabel } from "@/components/ui/field";
import { ChoiceSelect } from "@/components/ui/choice-select";
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
    <ChoiceSelect
      className="max-w-48"
      aria-label={t("agentsUi.chooseAgent")}
      value={choice.kind ?? ""}
      disabled={disabled || !choice.kind}
      onValueChange={(value) => choice.select(value as AgentKind)}
      options={[
        ...(!choice.kind
          ? [
              {
                value: "",
                label: t(
                  choice.loading
                    ? "agentsUi.checking"
                    : choice.error
                      ? "agentsUi.detectionFailed"
                      : "agentsUi.noneAvailable",
                ),
              },
            ]
          : []),
        ...choice.available.map((agent) => ({ value: agent.kind, label: agent.name })),
      ]}
    />
  </Field>;
}

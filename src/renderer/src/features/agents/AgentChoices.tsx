import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { AgentKind } from "@/domain/types";
import { AgentIcon } from "./AgentIcon";
import type { useAgentChoice } from "./AgentSelect";

export function AgentChoices({ choice, disabled, itemRef }: {
  choice: ReturnType<typeof useAgentChoice>;
  disabled?: boolean;
  itemRef?: (kind: AgentKind, node: HTMLSpanElement | null) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const unavailable = disabled || choice.loading || !!choice.error;
  return <FieldSet disabled={disabled}>
    <FieldLegend id={`${id}-label`}>{t("agentsUi.chooseAgent")}</FieldLegend>
    <RadioGroup data-session-choice="agent" aria-labelledby={`${id}-label`} value={choice.kind ?? null}
      disabled={unavailable} onValueChange={value => choice.select(value as AgentKind)}>
      {choice.available.map(agent => <Field key={agent.kind} orientation="horizontal" data-disabled={unavailable}>
        <RadioGroupItem ref={node => itemRef?.(agent.kind, node)} id={`${id}-${agent.kind}`} value={agent.kind} />
        <FieldLabel htmlFor={`${id}-${agent.kind}`}>
          <AgentIcon kind={agent.kind} className="size-4" />
          {agent.name}
        </FieldLabel>
      </Field>)}
    </RadioGroup>
    {(choice.loading || choice.error || !choice.kind) && <FieldDescription role="status">
      {t(choice.loading ? "agentsUi.checking" : choice.error ? "agentsUi.detectionFailed" : "agentsUi.noneInstalled")}
    </FieldDescription>}
  </FieldSet>;
}

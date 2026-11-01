import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { AiCommitField } from "@/features/ai-commit/AiCommitField";
import { openAiCommitSettings } from "@/features/ai-commit/api";
import type { DeliveryPreflight } from "@/domain/types";

type Repository = {
  id: string;
  repository_name: string;
  branch?: string | null;
};
type Props = {
  repositories: Repository[];
  value: (id: string) => string;
  onChange: (id: string, message: string) => void;
  disabled: boolean;
  preflights: Record<string, DeliveryPreflight>;
  onBusyChange: (id: string, busy: boolean) => void;
};
function Message({
  repository,
  value,
  onChange,
  disabled,
  preflight,
  onBusyChange,
}: Omit<Props, "repositories" | "preflights"> & {
  repository: Repository;
  preflight?: DeliveryPreflight;
}) {
  const busyChanged = useCallback(
    (busy: boolean) => onBusyChange(repository.id, busy),
    [onBusyChange, repository.id],
  );
  return (
    <Field data-invalid={!value(repository.id).trim()}>
      <FieldLabel
        htmlFor={`delivery-message-${repository.id}`}
        className="break-all"
      >
        {repository.repository_name}
      </FieldLabel>
      <AiCommitField
        id={`delivery-message-${repository.id}`}
        label={repository.repository_name}
        value={value(repository.id)}
        fallback={`Squash ${repository.branch ?? ""}`}
        onChange={(message) => onChange(repository.id, message)}
        disabled={disabled}
        invalid={!value(repository.id).trim()}
        showSettings={false}
        onBusyChange={busyChanged}
        input={
          preflight?.code_action === "squash_merge" && !preflight.blockers.length
            ? {
                repository_kind: "workspace",
                repository_id: repository.id,
                source: {
                  kind: "delivery",
                  expected_head: preflight.source_head,
                  expected_target_head: preflight.target_head,
                },
              }
            : null
        }
      />
    </Field>
  );
}
export function SquashDeliveryMessages({
  repositories,
  preflights,
  ...props
}: Props) {
  const { t } = useTranslation();
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={t("rewordUi.deliveryTitle")}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold">{t("rewordUi.deliveryTitle")}</h3>
        <Button type="button" variant="muted" size="sm" onClick={openAiCommitSettings}>
          <Settings data-icon="inline-start" />
          {t("aiCommit.settingsAction")}
        </Button>
      </div>
      <FieldGroup>
        {repositories.map((repository) => (
          <Message
            key={repository.id}
            repository={repository}
            preflight={preflights[repository.id]}
            {...props}
          />
        ))}
      </FieldGroup>
      <FieldDescription>{t("rewordUi.deliveryHint")}</FieldDescription>
    </section>
  );
}

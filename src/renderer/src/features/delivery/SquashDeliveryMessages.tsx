import { useTranslation } from "react-i18next";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export function SquashDeliveryMessages({ repositories, value, onChange, disabled }: {
  repositories: { id: string; repository_name: string }[];
  value: (id: string) => string;
  onChange: (id: string, message: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return <section className="flex flex-col gap-3" aria-label={t("rewordUi.deliveryTitle")}>
    <h3 className="text-sm font-semibold">{t("rewordUi.deliveryTitle")}</h3>
    <FieldGroup>
      {repositories.map(repository => <Field key={repository.id} data-invalid={!value(repository.id).trim()}>
        <FieldLabel htmlFor={`delivery-message-${repository.id}`} className="break-all">{repository.repository_name}</FieldLabel>
        <Textarea id={`delivery-message-${repository.id}`} value={value(repository.id)} onChange={event => onChange(repository.id, event.target.value)} disabled={disabled} aria-invalid={!value(repository.id).trim()} className="max-h-40" />
      </Field>)}
    </FieldGroup>
    <FieldDescription>{t("rewordUi.deliveryHint")}</FieldDescription>
  </section>;
}

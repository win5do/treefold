import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";

type Action = "local_merge" | "squash_merge" | "keep";
export function ForkDeliveryOptions({ continueWork, onContinueWork, action, onAction, disabled }: {
  continueWork: boolean; onContinueWork: (value: boolean) => void;
  action: Action; onAction: (value: Action) => void; disabled: boolean;
}) {
  const { t } = useTranslation();
  return <FieldGroup className="shrink-0">
    <div className="grid gap-3 sm:grid-cols-2">
      <Field>
        <FieldLabel htmlFor="fork-delivery-purpose">{t("deliveryUi.forkDelivery.purpose")}</FieldLabel>
        <NativeSelect id="fork-delivery-purpose" disabled={disabled} value={continueWork ? "continue" : "finish"} onChange={event => onContinueWork(event.target.value === "continue")}>
          <option value="finish">{t("deliveryUi.forkDelivery.finish")}</option>
          <option value="continue">{t("deliveryUi.forkDelivery.intermediate")}</option>
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="fork-delivery-action">{t("deliveryUi.forkDelivery.method")}</FieldLabel>
        <NativeSelect id="fork-delivery-action" disabled={disabled || continueWork} value={action === "keep" && !continueWork ? "keep" : "merge"} onChange={event => onAction(event.target.value === "keep" ? "keep" : "local_merge")}>
          <option value="merge">{t("deliveryUi.forkDelivery.merge")}</option>
          {!continueWork && <option value="keep">{t("deliveryUi.forkDelivery.abandon")}</option>}
        </NativeSelect>
      </Field>
    </div>
    {!continueWork && action !== "keep" && <Field orientation="horizontal">
      <Checkbox id="fork-delivery-squash" disabled={disabled} checked={action === "squash_merge"} onCheckedChange={checked => onAction(checked ? "squash_merge" : "local_merge")} />
      <FieldLabel htmlFor="fork-delivery-squash">{t("deliveryUi.forkDelivery.squash")}</FieldLabel>
    </Field>}
    {!continueWork && action === "squash_merge" && <Alert><AlertDescription>{t("deliveryUi.forkDelivery.squashHint")}</AlertDescription></Alert>}
  </FieldGroup>;
}

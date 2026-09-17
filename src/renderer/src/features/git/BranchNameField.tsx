import { useId, useState } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function generateBranchName() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const hash = Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `treefold/${date}-${hash}`;
}

export function BranchNameField({
  label = "Branch name",
  onChange,
}: {
  label?: string;
  onChange?: (value: string) => void;
}) {
  const id = useId();
  const [generated] = useState(generateBranchName);
  const [value, setValue] = useState("");

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        placeholder={generated}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={`${id}-description`}
        onChange={(event) => {
          setValue(event.target.value);
          onChange?.(event.target.value.trim());
        }}
      />
      <input type="hidden" name="branch" value={value.trim() || generated} />
      <FieldDescription id={`${id}-description`}>
        Leave empty to use the generated name, or enter your own.
      </FieldDescription>
    </Field>
  );
}

import type { ComponentProps, ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type SelectChoice = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

type ChoiceSelectProps = Omit<
  ComponentProps<typeof SelectTrigger>,
  "value" | "onChange" | "children"
> & {
  value: string;
  options: SelectChoice[];
  onValueChange: (value: string) => void;
};

// Simple single-value fields share the same trigger, theme, and portaled menu.
export function ChoiceSelect({
  value,
  options,
  onValueChange,
  name,
  disabled,
  ...triggerProps
}: ChoiceSelectProps) {
  return (
    <Select
      value={value}
      items={options}
      name={name}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <SelectTrigger {...triggerProps}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

import type { CSSProperties } from "react";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "@/lib/utils"
import { CheckIcon, MinusIcon } from "lucide-react"

function Checkbox({ className, indeterminate, style, ...props }: CheckboxPrimitive.Root.Props) {
  const checked = props.checked === true || indeterminate;
  const rootStyle: CSSProperties = {
    display: "inline-flex",
    width: "1rem",
    height: "1rem",
    minWidth: "1rem",
    minHeight: "1rem",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "4px",
    border: `1px solid ${checked ? "var(--primary)" : "var(--input)"}`,
    backgroundColor: checked ? "var(--primary)" : "transparent",
    color: checked ? "var(--primary-foreground)" : "var(--foreground)",
    boxSizing: "border-box",
    flexShrink: 0,
    margin: 0,
    padding: 0,
    ...style,
  };
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      indeterminate={indeterminate}
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-shadow outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground dark:data-checked:bg-primary dark:data-indeterminate:bg-primary",
        className
      )}
      style={rootStyle}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        style={{ display: "grid", placeContent: "center", width: "100%", height: "100%" }}
        className="text-current transition-none"
      >
        {indeterminate ? <MinusIcon size={14} /> : <CheckIcon size={14} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }

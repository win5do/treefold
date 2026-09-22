import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

function MetadataList({
  className,
  size = "default",
  ...props
}: ComponentProps<"dl"> & { size?: "default" | "compact" }) {
  return (
    <dl
      data-slot="metadata-list"
      className={cn(
        "flex min-w-0 flex-wrap gap-x-6 gap-y-2",
        size === "compact" ? "text-[10px]" : "text-[11px]",
        className,
      )}
      {...props}
    />
  );
}

function MetadataListItem({
  label,
  children,
  className,
  ...props
}: ComponentProps<"div"> & { label: ReactNode }) {
  return (
    <div
      data-slot="metadata-list-item"
      className={cn("flex min-w-0 max-w-full items-baseline gap-2", className)}
      {...props}
    >
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

export { MetadataList, MetadataListItem };

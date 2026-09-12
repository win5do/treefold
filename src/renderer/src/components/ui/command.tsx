import type { ComponentProps } from "react";
import { Command as Primitive } from "cmdk";
import { cn } from "@/lib/utils";

export function Command({
  className,
  ...props
}: ComponentProps<typeof Primitive>) {
  return (
    <Primitive
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}
export function CommandInput({
  className,
  ...props
}: ComponentProps<typeof Primitive.Input>) {
  return (
    <Primitive.Input
      className={cn(
        "h-9 w-full border-b border-border bg-transparent px-3 text-xs outline-none placeholder:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
export function CommandList({
  className,
  ...props
}: ComponentProps<typeof Primitive.List>) {
  return (
    <Primitive.List
      className={cn(
        "max-h-72 overflow-y-auto overflow-x-hidden p-1",
        className,
      )}
      {...props}
    />
  );
}
export function CommandEmpty(props: ComponentProps<typeof Primitive.Empty>) {
  return (
    <Primitive.Empty
      className="py-6 text-center text-xs text-muted-foreground"
      {...props}
    />
  );
}
export function CommandGroup(props: ComponentProps<typeof Primitive.Group>) {
  return (
    <Primitive.Group
      className="p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground"
      {...props}
    />
  );
}
export function CommandItem({
  className,
  ...props
}: ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        "flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-muted data-[selected=true]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
export function CommandShortcut(props: ComponentProps<"span">) {
  return (
    <span
      className="ml-auto shrink-0 text-xs text-muted-foreground"
      {...props}
    />
  );
}

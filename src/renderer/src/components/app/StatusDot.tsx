import { cn } from "@/lib/utils";

export function StatusDot({ status }: { status: string }) { return <span className={cn("size-1.5 shrink-0 rounded-full", status === "running" ? "bg-success" : status === "failed" ? "bg-destructive" : status === "starting" || status === "stopping" ? "bg-warning" : "bg-muted-foreground")} />; }

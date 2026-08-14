import { cn } from "@/lib/utils";

export function StatusDot({ status }: { status: string }) { return <span className={cn("size-1.5 shrink-0 rounded-full", status === "running" ? "bg-emerald-500" : status === "failed" ? "bg-red-500" : status === "starting" || status === "stopping" ? "bg-amber-500" : "bg-neutral-400")} />; }

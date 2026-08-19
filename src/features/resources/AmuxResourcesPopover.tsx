import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import { appApi } from "@/api/app";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AmuxStatus } from "@/domain/types";
import { amuxQuery } from "@/features/app/queries";
import { invalidateRuntimeQueries } from "@/features/app/runtimeInvalidation";
import { toast } from "@/lib/toast";

function formatDaemonUptime(status: AmuxStatus | undefined, t: (key: string, options?: Record<string, unknown>) => string) {
  if (!status?.running || !status.started_at) return "—";
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(status.started_at).getTime()) / 1000));
  if (elapsed < 60) return t("resources.duration.seconds", { count: elapsed });
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 60) return t("resources.duration.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes > 0
    ? t("resources.duration.hoursMinutes", { hours, minutes: remainingMinutes })
    : t("resources.duration.hours", { count: hours });
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0
    ? t("resources.duration.daysHours", { days, hours: remainingHours })
    : t("resources.duration.days", { count: days });
}

export function AmuxResourcesPopover() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const statusQuery = useQuery({ ...amuxQuery(), enabled: open });
  const status = statusQuery.data;
  const running = status?.running ?? false;

  const stop = async () => {
    setStopping(true);
    try {
      await appApi.stopAmux();
      setConfirmStop(false);
      setOpen(true);
      await invalidateRuntimeQueries(queryClient);
      toast.success("amux Daemon stopped");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("resources.stopFailed"));
    } finally {
      setStopping(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setConfirmStop(false);
    }
  }, [open]);

  return <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button data-testid="open-resources" size="icon" variant="ghost" aria-label={t("sidebar.resources")} title={t("sidebar.resources")} />}>
        <Network data-icon="inline-start" />
      </PopoverTrigger>
      <PopoverContent data-testid="amux-resources-popover" side="top" align="start" sideOffset={8} className="w-80 p-3">
        <div className="flex items-start justify-between gap-4">
          <PopoverHeader className="min-w-0">
            <PopoverTitle>amux Daemon</PopoverTitle>
            <PopoverDescription>{t("resources.description")}</PopoverDescription>
          </PopoverHeader>
          {running
            ? <Button data-testid="amux-running-status" size="xs" variant="ghost" onClick={() => setConfirmStop(true)}><span className="size-2 rounded-full bg-success" />{t("resources.running")}</Button>
            : <Tooltip>
                <TooltipTrigger render={<span data-testid="amux-stopped-status" tabIndex={0} className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" />}>
                  <span className="size-2 rounded-full bg-muted-foreground/50" />{t("resources.notStarted")}
                </TooltipTrigger>
                <TooltipContent side="top">{t("resources.lazyStartTip")}</TooltipContent>
              </Tooltip>}
        </div>
        <Table data-testid="amux-resource-table" className="table-fixed">
          <TableBody>
            <TableRow><TableCell className="w-20 text-muted-foreground">{t("resources.name")}</TableCell><TableCell className="truncate font-mono" title={status?.name}>{status?.name ?? "—"}</TableCell></TableRow>
            <TableRow><TableCell className="text-muted-foreground">{t("resources.uptime")}</TableCell><TableCell>{formatDaemonUptime(status, t)}</TableCell></TableRow>
            <TableRow><TableCell className="text-muted-foreground">Groups</TableCell><TableCell>{status?.active_groups ?? 0}</TableCell></TableRow>
            <TableRow><TableCell className="text-muted-foreground">Processes</TableCell><TableCell>{status?.active_processes ?? 0}</TableCell></TableRow>
          </TableBody>
        </Table>
        {statusQuery.error && <p role="alert" className="text-xs text-destructive">{statusQuery.error.message}</p>}
      </PopoverContent>
    </Popover>
    <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
      <AlertDialogContent data-testid="stop-amux-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("resources.stopTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("resources.stopDescription", { groups: status?.active_groups ?? 0, processes: status?.active_processes ?? 0 })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={stopping}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={stopping} onClick={() => void stop()}>{stopping ? t("resources.stopping") : t("resources.stop")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

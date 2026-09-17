import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { appApi } from "@/api/app";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import type { AgentIntegrationState } from "@/domain/types";
import { agentIntegrationQuery, appKeys } from "@/features/app/queries";
import { toast } from "@/lib/toast";

const componentLabels = {
  treefold_cli: "treefold CLI",
  amux_cli: "amux CLI",
  treefold_skill: "Treefold Skill",
  amux_skill: "amux Skill",
} as const;

function badgeVariant(state: AgentIntegrationState) {
  if (state === "ready") return "success" as const;
  if (state === "conflict" || state === "unavailable") return "destructive" as const;
  return "warning" as const;
}

export function AgentIntegrationPopover() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const prompted = useRef(false);
  const statusQuery = useQuery(agentIntegrationQuery());
  const status = statusQuery.data;
  const ready = status?.state === "ready";

  useEffect(() => {
    if (!status || ready || prompted.current) return;
    prompted.current = true;
    toast.warning(t("integration.promptTitle"), { description: t("integration.promptDescription"), timeout: 8_000 });
  }, [ready, status, t]);

  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await operation();
      await queryClient.invalidateQueries({ queryKey: appKeys.agentIntegration });
      toast.success(success);
    } catch (cause) {
      toast.errorFrom(cause, t("integration.failed"));
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button data-testid="open-agent-integration" size="icon" variant="ghost" aria-label={t("integration.title")} title={t("integration.title")} className="relative" />}>
        <Cable data-icon="inline-start" />
        {!ready && <span data-testid="agent-integration-indicator" className="absolute right-1 top-1 size-2 rounded-full bg-warning ring-2 ring-background" />}
      </PopoverTrigger>
      <PopoverContent data-testid="agent-integration-popover" side="top" align="start" sideOffset={8} className="w-96 p-3">
        <div className="flex items-start justify-between gap-3">
          <PopoverHeader>
            <PopoverTitle>{t("integration.title")}</PopoverTitle>
            <PopoverDescription>{t("integration.description")}</PopoverDescription>
          </PopoverHeader>
          <Badge variant={badgeVariant(status?.state ?? "unavailable")}>{t(`integration.states.${status?.state ?? "unavailable"}`)}</Badge>
        </div>
        <Table data-testid="agent-integration-table" className="table-fixed">
          <TableBody>
            <TableRow><TableCell className="w-24 text-muted-foreground">{t("integrationUi.app")}</TableCell><TableCell className="font-mono">{status?.app_version ?? "—"}</TableCell></TableRow>
            <TableRow><TableCell className="text-muted-foreground">{t("integrationUi.bundle")}</TableCell><TableCell className="truncate font-mono" title={status?.bundle_path}>{status?.bundle_version ?? "—"}</TableCell></TableRow>
            <TableRow><TableCell className="text-muted-foreground">{t("integrationUi.protocol")}</TableCell><TableCell className="font-mono">{status?.protocol_version ?? "—"}</TableCell></TableRow>
            {status?.components.map((component) => <TableRow key={component.id}>
              <TableCell className="text-muted-foreground">{componentLabels[component.id]}</TableCell>
              <TableCell>
                <div className="flex items-center justify-between gap-2"><span className="font-mono">{component.version}</span><Badge variant={badgeVariant(component.state)}>{t(`integration.states.${component.state}`)}</Badge></div>
                <p className="truncate font-mono text-[0.625rem] text-muted-foreground" title={component.install_path ?? component.source_path}>{component.install_path ?? component.source_path}</p>
                {component.detail && <p className="text-[0.625rem] text-muted-foreground">{component.detail}</p>}
              </TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
        {statusQuery.error && <p role="alert" className="text-xs text-destructive">{statusQuery.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void statusQuery.refetch()}><RefreshCw data-icon="inline-start" />{t("integration.recheck")}</Button>
          {ready && <Button data-testid="uninstall-agent-integration" size="sm" variant="outline" disabled={busy} onClick={() => setConfirmUninstall(true)}><Trash2 data-icon="inline-start" />{t("integration.uninstall")}</Button>}
          <Button data-testid="sync-agent-integration" size="sm" disabled={busy || status?.state === "unavailable"} onClick={() => void mutate(appApi.syncAgentIntegration, t("integration.synced"))}>{t(ready ? "integration.sync" : "integration.integrate")}</Button>
        </div>
      </PopoverContent>
    </Popover>
    <AlertDialog open={confirmUninstall} onOpenChange={setConfirmUninstall}>
      <AlertDialogContent data-testid="uninstall-agent-integration-dialog">
        <AlertDialogHeader><AlertDialogTitle>{t("integration.uninstallTitle")}</AlertDialogTitle><AlertDialogDescription>{t("integration.uninstallDescription")}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={() => void mutate(async () => { await appApi.uninstallAgentIntegration(); setConfirmUninstall(false); }, t("integration.uninstalled"))}>{t("integration.uninstall")}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

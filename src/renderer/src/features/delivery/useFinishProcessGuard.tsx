import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AGENT_NAMES, isAgentKind } from "@/features/agents/model";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { finishProcesses, type FinishProcess } from "./processesApi";

export function useFinishProcessGuard({ workspaceId, continueWork, execute, onWait }: {
  workspaceId?: string;
  continueWork: boolean;
  execute: () => Promise<boolean>;
  onWait: () => void;
}) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<FinishProcess[] | null>(null);
  const request = useRef<AbortController | null>(null);
  const waitButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setConfirmation(null);
    setError("");
    setChecking(false);
    return () => { request.current?.abort(); request.current = null; };
  }, [workspaceId]);

  const checkAndExecute = async () => {
    if (!workspaceId || request.current || confirmation) return false;
    setError("");
    if (continueWork) return execute();
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    try {
      const processes = await finishProcesses(workspaceId, controller.signal);
      if (controller.signal.aborted) return false;
      if (processes.length) {
        setConfirmation(processes);
        return false;
      }
      return await execute();
    } catch (cause) {
      if (!controller.signal.aborted) setError(t("deliveryUi.processes.checkFailed", {
        error: cause instanceof Error ? cause.message : String(cause),
      }));
      return false;
    } finally {
      if (request.current === controller) { request.current = null; setChecking(false); }
    }
  };
  const cancel = () => {
    request.current?.abort();
    request.current = null;
    setChecking(false);
    setConfirmation(null);
  };
  const wait = () => { cancel(); onWait(); };
  const force = async () => {
    if (!confirmation || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    setConfirmation(null);
    try { await execute(); }
    finally {
      if (request.current === controller) { request.current = null; setChecking(false); }
    }
  };
  return {
    checking, error, cancel, execute: checkAndExecute,
    dialog: <AlertDialog open={!!confirmation} onOpenChange={open => { if (!open) wait(); }}>
      <AlertDialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg" initialFocus={waitButton}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deliveryUi.processes.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("deliveryUi.processes.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto text-sm">
          {confirmation?.map(process => <li key={process.session_id} className="break-words">
            {process.name} · {isAgentKind(process.kind) ? AGENT_NAMES[process.kind] : t(`states.${process.kind}`, { defaultValue: process.kind })}
            {process.pid > 0 && <span className="text-muted-foreground"> · PID {process.pid}</span>}
          </li>)}
        </ul>
        <p className="text-xs text-muted-foreground">{t("deliveryUi.processes.hint")}</p>
        <AlertDialogFooter>
          <Button variant="destructive" onClick={() => void force()}>{t("deliveryUi.processes.force")}</Button>
          <Button ref={waitButton} onClick={wait}>{t("deliveryUi.processes.wait")}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>,
  };
}

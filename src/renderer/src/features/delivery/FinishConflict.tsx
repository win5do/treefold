import { useEffect, useState } from "react";
import { workspacesApi } from "@/api/workspaces";
import { sessionsApi } from "@/api/sessions";
import { ParentOperationPanel } from "@/features/workspace/ParentOperationDialog";
import type { ParentOperation, Session } from "@/domain/types";

export function FinishConflict({
  id,
  onOpenSession,
}: {
  id: string;
  onOpenSession: (operation: ParentOperation, session: Session) => void;
}) {
  const [operation, setOperation] = useState<ParentOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    setOperation(null);
    setError("");
    const load = () =>
      workspacesApi
        .parentOperation(id)
        .then((value) => {
          if (!stopped) {
            setOperation(value);
            setError("");
          }
        })
        .catch((cause) => {
          if (!stopped) setError(String(cause));
        });
    void load();
    const timer = setInterval(() => void load(), 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [id]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      setOperation(await workspacesApi.parentOperation(id));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {operation && (
        <ParentOperationPanel
          operation={operation}
          busy={busy}
          onResolve={() =>
            void run(async () => {
              const session = await workspacesApi.resolveParentOperation(id);
              onOpenSession(operation, session);
            })
          }
          onOpenSession={() =>
            void run(async () => {
              if (operation.resolver_session_id)
                onOpenSession(
                  operation,
                  await sessionsApi.get(operation.resolver_session_id),
                );
            })
          }
          onAbort={() => void run(() => workspacesApi.abortParentOperation(id))}
        />
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

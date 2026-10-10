import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { projectsApi } from "@/api/projects";
import { desktop } from "@/lib/desktop";
import { toast } from "@/lib/toast";
import i18n from "@/i18n";
import type { OpenProjectRequest } from "../../../../preload/bridge";

function reportError(cause: unknown) { toast.errorFrom(cause, i18n.t("appFeedback.operationFailed")); }

export function useProjectOpening() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [initialPath, setInitialPath] = useState<string>();
  const [requestId, setRequestId] = useState(0);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let latest = 0;
    let controller: AbortController | undefined;
    async function receive(request: OpenProjectRequest | null) {
      if (disposed || !request || request.id <= latest) return;
      latest = request.id;
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const result = await projectsApi.resolvePath(request.path, current.signal);
        if (current.signal.aborted) return;
        if (result.project_id) {
          setOpen(false);
          navigate(`/projects/${result.project_id}`);
        } else {
          setInitialPath(result.path);
          setRequestId(request.id);
          setOpen(true);
        }
      } catch (cause) {
        if (current.signal.aborted) return;
        reportError(cause);
      }
      if (!current.signal.aborted) {
        await desktop!.acknowledgeOpenProject(request.id).catch(cause => {
          if (!disposed) reportError(cause);
        });
      }
    }
    const unsubscribe = desktop.onOpenProject(request => { void receive(request); });
    void desktop.pendingOpenProject().then(receive).catch(cause => { if (!disposed) reportError(cause); });
    return () => { disposed = true; controller?.abort(); unsubscribe(); };
  }, [navigate]);
  return { open, initialPath, requestId, setOpen(value: boolean) { setInitialPath(undefined); setOpen(value); } };
}

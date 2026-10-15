import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { sessionsApi } from "@/api/sessions";
import type { Session } from "@/domain/types";
import { toast } from "@/lib/toast";
import { RemoveSessionButton } from "./RemoveSessionButton";

export function SessionListActions({ session, path, available, busy }: {
  session: Session;
  path: string;
  available: boolean;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const canResume = !session.initializing && !session.initialization_error && ["exited", "stopped", "failed"].includes(session.status);
  const open = async (resume: boolean) => {
    if (!resume && session.visibility === "visible") {
      navigate(path);
      return;
    }
    setPending(true);
    try {
      try {
        if (resume) await sessionsApi.restart(session.id);
        if (session.visibility !== "visible") await sessionsApi.open(session.id);
      } finally {
        await queryClient.invalidateQueries({ predicate: ({ queryKey }) =>
          ["sidebar", "project-summaries", "project-sessions", "workspace-sessions", "project", "workspace"].includes(String(queryKey[0])),
        });
      }
      navigate(path);
    } catch (cause) {
      toast.errorFrom(cause, t("appFeedback.operationFailed"));
    } finally {
      setPending(false);
    }
  };
  return <>
    {available && <>
      <Button size="sm" variant="secondary" disabled={busy || pending} onClick={() => void open(false)}>{t("terminalUi.view")}</Button>
      {canResume && <Button size="sm" variant="secondary" disabled={busy || pending} onClick={() => void open(true)}>{t("terminalUi.resume")}</Button>}
    </>}
    <RemoveSessionButton session={session} disabled={busy || pending || Boolean(session.initializing)} />
  </>;
}

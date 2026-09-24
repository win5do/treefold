import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { workspacesApi } from "@/api/workspaces";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { invalidateHierarchyQueries } from "@/features/app/runtimeInvalidation";
import { toast } from "@/lib/toast";

export function ReopenForkButton({ id }: { id: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const reopen = async () => {
    setBusy(true);
    try {
      await workspacesApi.reopen(id);
      await invalidateHierarchyQueries(client);
    } catch (error) {
      if (error instanceof ApiError && error.code === "FORK_REOPEN_UNAVAILABLE") {
        toast.error(t("workspaceUi.reopenUnavailable"));
      } else if (error instanceof ApiError && error.code === "FINISH_SESSION_ACTIVE") {
        toast.error(t("deliveryUi.recovery.sessionActive"));
      } else {
        toast.errorFrom(error, t("workspaceUi.reopenFailed"));
      }
    } finally { setBusy(false); }
  };
  return <Button size="sm" disabled={busy} onClick={() => void reopen()}>
    <RotateCcw data-icon="inline-start" />{t("workspaceUi.reopenFork")}
  </Button>;
}

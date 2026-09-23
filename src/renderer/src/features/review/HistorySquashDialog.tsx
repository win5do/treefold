import { ApiError } from "@/api/client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { GitCommit, GitHistory } from "@/domain/types";
import { historySquash, type SquashPreview } from "./historySquashApi";

export function HistorySquashDialog({ open, onOpenChange, repositoryKind, repositoryId, commits, head, onHistoryChange }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  repositoryKind: "project" | "workspace"; repositoryId: string;
  commits: GitCommit[]; head: string; onHistoryChange: (history: GitHistory) => void;
}) {
  const { t } = useTranslation();
  const currentRepository = useRef(repositoryId);
  currentRepository.current = repositoryId;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const errorText = (cause: unknown) => cause instanceof ApiError && cause.code !== "SQUASH_BLOCKED" && cause.code.startsWith("SQUASH_")
    ? t(`squashUi.errors.${cause.code}`, { defaultValue: cause.message }) : String(cause);
  const [preview, setPreview] = useState<SquashPreview | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<{ id: string; head: string } | null>(null);
  const selectionKey = commits.map((commit) => commit.hash).join(",");
  useEffect(() => { setRecovery(null); setError(""); onOpenChange(false); }, [repositoryKind, repositoryId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setPreview(null); setError(""); setBusy(true);
    setMessage(commits.map((commit) => commit.subject).join("\n\n"));
    void historySquash(repositoryKind, repositoryId, { action: "preview", commits: selectionKey.split(","), expected_head: head }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setPreview(result.preview); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [open, repositoryKind, repositoryId, selectionKey, head]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (undo: boolean) => {
    if (busy || (undo && !recovery)) return;
    setBusy(true); setError("");
    try {
      const result = await historySquash(repositoryKind, repositoryId, undo
        ? { action: "undo", recovery_id: recovery!.id, expected_head: recovery!.head }
        : { action: "apply", commits: selectionKey.split(","), expected_head: head, message });
      if (!mounted.current || currentRepository.current !== repositoryId) return;
      if (result.history) {
        setRecovery(result.recovery_id ? { id: result.recovery_id, head: result.history.commits[0].hash } : null);
        onOpenChange(false);
        onHistoryChange(result.history);
      }
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  return <>
    {recovery && <div className="flex flex-col gap-2 p-3">
      <p>{t("squashUi.completed")}</p>
      <Button variant="outline" size="sm" disabled={busy || recovery.head !== head} onClick={() => void run(true)}>{t("squashUi.undo")}</Button>
      <p className="text-xs text-muted-foreground">{t("squashUi.undoHint")}</p>
    </div>}
    {!open && error && <p role="alert" className="p-3 text-destructive">{t("squashUi.failed")} {error}</p>}
    <Dialog open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("squashUi.title")}</DialogTitle>
          <DialogDescription>{t("squashUi.description")}</DialogDescription>
        </DialogHeader>
        {preview && <div className="flex flex-col gap-2">
          <p>{t("squashUi.summary", { count: preview.selected_count, replayed: preview.replayed_count })}</p>
          <p className="break-all text-xs text-muted-foreground">{t("squashUi.base", { base: preview.base })}</p>
          {preview.shared_branches.length > 0 && <Alert variant="warning"><AlertDescription>{t("squashUi.shared", { branches: preview.shared_branches.join(", ") })}</AlertDescription></Alert>}
        </div>}
        <FieldGroup><Field data-invalid={!message.trim()}>
          <FieldLabel htmlFor="squash-message">{t("squashUi.message")}</FieldLabel>
          <Textarea id="squash-message" value={message} onChange={(event) => setMessage(event.target.value)} disabled={busy} aria-invalid={!message.trim()} className="max-h-48" />
        </Field></FieldGroup>
        <p className="text-xs text-muted-foreground">{t("squashUi.metadata")}</p>
        {error && <p role="alert" className="break-words text-destructive">{t("squashUi.failed")} {error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{t("reviewUi.cancel")}</Button>
          <Button disabled={busy || !preview || !message.trim()} onClick={() => void run(false)}>{busy ? t("reviewUi.working") : t("squashUi.title")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { GitHistory } from "@/domain/types";
import { toast } from "@/lib/toast";
import { rewordCommit, type RewordPreview } from "./rewordApi";

// Mounted for a single repository/commit so in-flight previews cannot replace a
// user's draft when background history refreshes or the selected repository changes.
export function EditCommitMessageDialog({ repositoryKind, repositoryId, head, onClose, onHistoryChange }: {
  repositoryKind: "project" | "workspace"; repositoryId: string; head: string;
  onClose: () => void; onHistoryChange: (history: GitHistory) => void;
}) {
  const { t } = useTranslation();
  const mounted = useRef(true);
  const cancelWarningRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [preview, setPreview] = useState<RewordPreview | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState(false);
  const [error, setError] = useState("");
  const errorText = (cause: unknown) => cause instanceof ApiError && cause.code.startsWith("REWORD_")
    ? t(`rewordUi.errors.${cause.code}`, { defaultValue: cause.message }) : String(cause);
  useEffect(() => {
    const controller = new AbortController();
    void rewordCommit(repositoryKind, repositoryId, { action: "preview", expected_head: head }, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setPreview(result.preview); setMessage(result.preview?.message ?? ""); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [repositoryKind, repositoryId, head]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (confirmed: boolean) => {
    if (!preview || saving || !message.trim()) return;
    if (!confirmed && preview.shared_refs.length) { setWarning(true); return; }
    setWarning(false); setSaving(true); setError("");
    try {
      const result = await rewordCommit(repositoryKind, repositoryId, {
        action: "apply", expected_head: head, expected_branch: preview.branch, message,
        confirmed_refs: confirmed ? preview.shared_refs : [],
      });
      if (!mounted.current) return;
      if (result.history) {
        onHistoryChange(result.history);
        toast.success(t("rewordUi.saved"));
        onClose();
      } else if (result.preview) {
        setPreview(result.preview); setWarning(true);
      }
    } catch (cause) { setError(errorText(cause)); }
    finally { setSaving(false); }
  };
  return <>
    <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("rewordUi.title")}</DialogTitle>
          <DialogDescription>{t("rewordUi.description")}</DialogDescription>
        </DialogHeader>
        {loading && <p role="status">{t("states.checking")}</p>}
        <Field data-invalid={Boolean(preview) && !message.trim()}>
          <FieldLabel htmlFor="reword-message">{t("rewordUi.message")}</FieldLabel>
          <Textarea id="reword-message" value={message} onChange={event => setMessage(event.target.value)} disabled={!preview || saving} aria-invalid={Boolean(preview) && !message.trim()} className="max-h-64" />
        </Field>
        {error && <p role="alert" className="break-words text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>{t("reviewUi.cancel")}</Button>
          <Button disabled={!preview || saving || !message.trim() || message.trimEnd() === preview.message.trimEnd()} onClick={() => void save(false)}>{saving ? t("reviewUi.working") : t("rewordUi.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={warning} onOpenChange={setWarning}>
      <AlertDialogContent initialFocus={cancelWarningRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("rewordUi.warningTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("rewordUi.warningDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-36 overflow-y-auto break-all text-xs">{preview?.shared_refs.map(reference => <li key={reference}>{reference}</li>)}</ul>
        <AlertDialogFooter className="flex-row justify-end">
          <AlertDialogAction variant="destructive" onClick={() => void save(true)}>{t("rewordUi.continue")}</AlertDialogAction>
          <AlertDialogCancel ref={cancelWarningRef} render={<Button />}>{t("reviewUi.cancel")}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

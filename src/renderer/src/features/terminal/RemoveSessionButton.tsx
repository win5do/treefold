import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { sessionsApi } from "@/api/sessions";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import type { Session } from "@/domain/types";
import { toast } from "@/lib/toast";

export function RemoveSessionButton({ session, disabled }: { session: Session; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const queryClient = useQueryClient();
  if (session.kind !== "codex") return null;
  const remove = async () => {
    setRemoving(true);
    try {
      await sessionsApi.delete(session.id);
      await queryClient.invalidateQueries({ predicate: ({ queryKey }) => ["sidebar", "project-sessions", "workspace-sessions", "project", "workspace"].includes(String(queryKey[0])) });
      setOpen(false);
    } catch (cause) {
      toast.errorFrom(cause, "Could not remove Session");
    } finally {
      setRemoving(false);
    }
  };
  return <>
    <Button size="icon-sm" variant="destructive-ghost" disabled={disabled || removing} title="Remove from Treefold" aria-label="Remove from Treefold" onClick={() => setOpen(true)}><Trash2 data-icon="inline-start" /></Button>
    <AlertDialog open={open} onOpenChange={(value) => { if (!removing) setOpen(value); }}>
      <AlertDialogContent>
        <AlertDialogTitle>Remove Session from Treefold?</AlertDialogTitle>
        <AlertDialogDescription>Remove “{session.name}” and stop it if running. Its Codex conversation remains available in Codex.</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={removing} onClick={() => void remove()}>Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

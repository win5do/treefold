import { useEffect, useState } from "react";
import {
  CircleCheck,
  GitBranch,
  TriangleAlert,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { projectsApi } from "@/api/projects";
import type {
  GitWorktree,
  WorktreeDeletePrecheck,
} from "@/domain/types";

export function DeleteWorktreeDialog({
  target,
  busy,
  onOpenChange,
  onConfirm,
}: {
  target: GitWorktree | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<boolean>;
}) {
  const [precheck, setPrecheck] = useState<WorktreeDeletePrecheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [checkVersion, setCheckVersion] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    setChecking(true);
    setPrecheck(null);
    setError("");
    void projectsApi
      .precheckWorktreeDeletion(
        target.project_repository_id,
        target,
        controller.signal,
      )
      .then(setPrecheck)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Precheck failed");
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [target, checkVersion]);

  const canDelete =
    !checking &&
    !submitting &&
    !error &&
    Boolean(precheck && precheck.status !== "blocked");
  const canRecheck = !checking && (Boolean(error) || precheck?.status === "blocked");

  async function remove() {
    setSubmitting(true);
    try {
      if (!(await onConfirm())) setCheckVersion((current) => current + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="delete-worktree-dialog" className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete worktree?</AlertDialogTitle>
          <AlertDialogDescription>
            Treefold will remove this checkout. Its local branch will be preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {target && (
          <dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Branch</dt>
            <dd className="flex min-w-0 items-center gap-2 font-medium">
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate" title={target.branch || "detached"}>
                {target.branch || "detached"}
              </span>
            </dd>
            <dt className="text-muted-foreground">Path</dt>
            <dd className="min-w-0 truncate font-mono" title={target.path}>
              {target.path}
            </dd>
          </dl>
        )}

        {checking && (
          <Alert data-testid="worktree-delete-checking">
            <Spinner />
            <AlertTitle>Checking worktree state</AlertTitle>
            <AlertDescription>
              Looking for uncommitted changes and active Workspace ownership.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive" data-testid="worktree-delete-error">
            <TriangleAlert />
            <AlertTitle>Could not check this worktree</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {precheck?.status === "blocked" && (
          <Alert variant="destructive" data-testid="worktree-delete-blocked">
            <TriangleAlert />
            <AlertTitle>Resolve these changes before deleting</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {precheck.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {precheck?.status === "stale" && (
          <Alert variant="warning" data-testid="worktree-delete-stale">
            <TriangleAlert />
            <AlertTitle>Stale worktree registration</AlertTitle>
            <AlertDescription>
              {precheck.warnings[0] ??
                "The directory is missing. Only its Git registration will be removed."}
            </AlertDescription>
          </Alert>
        )}

        {precheck?.status === "ready" && (
          <Alert data-testid="worktree-delete-ready">
            <CircleCheck />
            <AlertTitle className="flex items-center gap-2">
              Ready to delete <Badge variant="success">clean</Badge>
            </AlertTitle>
            <AlertDescription>
              No tracked changes or untracked files were found.
            </AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy || submitting}>Cancel</AlertDialogCancel>
          {canRecheck && (
            <Button
              variant="outline"
              disabled={busy || submitting}
              onClick={() => setCheckVersion((current) => current + 1)}
            >
              Check again
            </Button>
          )}
          <AlertDialogAction
            variant="destructive"
            disabled={busy || submitting || !canDelete}
            onClick={() => void remove()}
          >
            {submitting && <Spinner data-icon="inline-start" />}
            {submitting ? "Starting..." : "Delete worktree"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

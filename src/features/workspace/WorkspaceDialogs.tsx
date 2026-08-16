import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectDetail, WorkspaceLocation } from "@/domain/types";

export function CreateWorkspaceDialog({
  project,
  busy,
  onOpenChange,
  onSubmit,
}: {
  project: ProjectDetail | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          New Workspace
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          Each Git location uses its own base branch and delivery mode.
        </DialogDescription>
        <form
          key={project ? project.id : "closed"}
          className="mt-6 flex flex-col gap-3"
          onSubmit={onSubmit}
        >
          <Input name="name" placeholder="Feature or fix name" required />
          <Textarea
            name="description"
            placeholder="Scope and expected outcome"
          />
          <label className="block text-[11px] text-muted-foreground">
            Shared local branch
            <Input
              className="mt-1 font-mono text-xs"
              name="branch"
              placeholder="Leave empty to generate treefold/name-random"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[11px] text-muted-foreground">
              Default repo remote
              <Input
                className="mt-1 font-mono text-xs"
                name="remote_name"
                defaultValue={project?.preferred_remote ?? ""}
                placeholder="origin"
              />
            </label>
            <label className="block text-[11px] text-muted-foreground">
              Default repo feature branch
              <Input
                className="mt-1 font-mono text-xs"
                name="remote_branch"
                placeholder="feature/my-change (optional)"
              />
            </label>
          </div>
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
            Base branches and Finish behavior come from repository locations.
            The shared branch name is used across all Git worktrees.
          </p>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              Create Workspace
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function ConfigureWorkspaceLocationDialog({
  location,
  busy,
  onOpenChange,
  onSubmit,
}: {
  location: WorkspaceLocation | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={Boolean(location)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {location?.remote_branch ? "Change" : "Set"} upstream
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          Configure the remote feature branch for {location?.location_name}.
          Base branch and delivery mode remain inherited from its Project
          repository.
        </DialogDescription>
        {location && (
          <form
            key={JSON.stringify([
              location.id,
              location.remote_name,
              location.remote_branch,
            ])}
            className="mt-6 flex flex-col gap-3"
            onSubmit={onSubmit}
          >
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[11px] text-muted-foreground">
                Remote
                <Input
                  className="mt-1 font-mono text-xs"
                  name="remote_name"
                  defaultValue={location.remote_name ?? ""}
                  placeholder="origin"
                  required
                />
              </label>
              <label className="block text-[11px] text-muted-foreground">
                Remote feature branch
                <Input
                  className="mt-1 font-mono text-xs"
                  name="remote_branch"
                  defaultValue={location.remote_branch ?? ""}
                  placeholder={location.branch || "feature/my-change"}
                  required
                />
              </label>
            </div>
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
              Pull and Push for this repository use this upstream. Treefold
              never force pushes.
            </p>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                Save upstream
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

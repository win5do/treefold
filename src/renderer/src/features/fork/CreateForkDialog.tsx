import type { FormEvent } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BranchNameField } from "@/features/git/BranchNameField";
import type { Workspace } from "@/domain/types";

export function CreateForkDialog({ workspace, busy, onOpenChange, onSubmit }: {
  workspace: Workspace | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={Boolean(workspace)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
          <GitBranch className="size-5" />Fork work
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          从 {workspace?.name} 当前 HEAD 创建一个独立 worktree。Fork 不能继续嵌套。
        </DialogDescription>
        <form key={workspace?.id ?? "closed"} className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel className="sr-only" htmlFor="fork-name">Fork name</FieldLabel>
              <Input id="fork-name" name="name" placeholder="Fork name" required />
            </Field>
            <Field>
              <FieldLabel className="sr-only" htmlFor="fork-description">Fork description</FieldLabel>
              <Textarea id="fork-description" name="description" placeholder="Independent feature or experiment" />
            </Field>
            <BranchNameField />
          </FieldGroup>
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
            父 workspace 必须 clean；完成后可以通过 Close and settle 合回父 Workspace。
          </div>
          <div className="flex justify-end"><Button type="submit" disabled={busy}>Create Fork</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

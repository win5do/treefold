import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Project, RenameTarget, Workspace } from "@/domain/types";

export function RenameDialog({
  target,
  busy,
  onOpenChange,
  onSubmit,
}: {
  target: RenameTarget | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, description?: string) => void;
}) {
  const { t } = useTranslation();
  const hasDescription = target?.kind !== "session";
  const typeLabel = target ? t(`sidebar.renameTypes.${target.kind}`) : "";
  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("sidebar.renameTitle", { type: typeLabel })}
          </DialogTitle>
          <DialogDescription>
            {t(
              hasDescription
                ? "sidebar.renameDescription"
                : "sidebar.renameSessionDescription",
              { type: typeLabel },
            )}
          </DialogDescription>
        </DialogHeader>
        {target && (
          <form
            key={`${target.kind}:${target.value.id}:${target.value.name}`}
            className="mt-4 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              onSubmit(
                String(form.get("name") ?? ""),
                hasDescription
                  ? String(form.get("description") ?? "")
                  : undefined,
              );
            }}
          >
            <label className="text-xs font-medium text-foreground">
              {t("sidebar.name")}
              <Input
                className="mt-1"
                name="name"
                defaultValue={target.value.name}
                autoFocus
                required
              />
            </label>
            {hasDescription && (
              <label className="text-xs font-medium text-foreground">
                {t("sidebar.description")}
                <Textarea
                  className="mt-1"
                  name="description"
                  defaultValue={
                    (target.value as Project | Workspace).description
                  }
                />
              </label>
            )}
            <div className="flex justify-end">
              <Button data-testid="rename-submit" type="submit" disabled={busy}>
                {t("common.save")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}


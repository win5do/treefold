import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { GitBranches, GitBranchRef } from "@/domain/types";
import { compactPath } from "@/lib/compactPath";
import { BranchList } from "./BranchList";

export function branchRefLabel(ref: GitBranchRef) {
  return ref.kind === "remote" ? `${ref.remote}/${ref.branch}` : ref.branch;
}

export function BranchPicker({
  id,
  label,
  repositoryName,
  value,
  branches,
  loading,
  disabled,
  error,
  rejectOccupied,
  onRefresh,
  onChange,
}: {
  id: string;
  label: string;
  repositoryName: string;
  value: GitBranchRef | null;
  branches: GitBranches;
  loading: boolean;
  disabled: boolean;
  error?: string;
  rejectOccupied?: boolean;
  onRefresh: () => void;
  onChange: (value: GitBranchRef) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        id={id}
        type="button"
        variant="outline"
        className="w-full justify-between"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <span className="truncate">
          {value ? branchRefLabel(value) : t("workspaceUi.chooseBranch")}
        </span>
        <ChevronDown data-icon="inline-end" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{repositoryName}</DialogDescription>
          <BranchList
            branches={branches}
            loading={loading}
            error={error}
            busy={disabled}
            onRefresh={onRefresh}
            renderBranch={(ref) => {
              const occupied =
                rejectOccupied && ref.kind === "local"
                  ? branches.occupied?.[ref.branch]
                  : undefined;
              const selected =
                value &&
                value.kind === ref.kind &&
                branchRefLabel(value) === branchRefLabel(ref);
              return (
                <Button
                  type="button"
                  variant={selected ? "secondary" : "ghost"}
                  className="h-auto min-h-8 w-full justify-start py-2"
                  disabled={disabled || loading || Boolean(occupied)}
                  data-testid={`branch-${ref.kind}-${branchRefLabel(ref)}`}
                  onClick={() => {
                    onChange(ref);
                    setOpen(false);
                  }}
                >
                  <GitBranch data-icon="inline-start" />
                  <span className="min-w-0 text-left">
                    <span className="block truncate">{ref.branch}</span>
                    {occupied && (
                      <span
                        className="pointer-events-auto block whitespace-normal break-all text-xs text-muted-foreground"
                        title={occupied}
                      >
                        {t("workspaceUi.branchOccupied", {
                          path: compactPath(occupied, 40),
                        })}
                      </span>
                    )}
                  </span>
                </Button>
              );
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

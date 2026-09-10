import { useMemo, useState } from "react";
import type { Directory } from "@/domain/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function NewSessionDialog({
  name,
  directories,
  preferredDirectory,
  initialKind,
  onClose,
  onCreate,
}: {
  name: string;
  directories: Directory[];
  preferredDirectory?: string;
  initialKind: "shell" | "codex";
  onClose: () => void;
  onCreate: (kind: "shell" | "codex", directory: Directory) => void;
}) {
  // Follow the active Session until the user explicitly selects a type.
  // Router transitions can settle just after the shortcut opens this dialog.
  const [chosenKind, setKind] = useState<"shell" | "codex" | null>(null);
  const kind = chosenKind ?? initialKind;
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | undefined>();
  const filtered = useMemo(
    () =>
      directories.filter((directory) =>
        `${directory.name} ${directory.path}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [directories, search],
  );
  const available = filtered.filter(
    (directory) =>
      kind === "shell" ||
      (directory.is_git && directory.git_status === "ready"),
  );
  const active =
    available.find(
      (directory) => directory.id === (selected ?? preferredDirectory),
    ) ?? available[0];
  const create = () => {
    if (active) onCreate(kind, active);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (
            (event.key === "ArrowDown" || event.key === "ArrowUp") &&
            event.target instanceof HTMLInputElement
          ) {
            event.preventDefault();
            if (available.length)
              setSelected(
                available[
                  (available.findIndex(
                    (directory) => directory.id === active?.id,
                  ) +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    available.length) %
                    available.length
                ].id,
              );
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>新建 Session</DialogTitle>
          <DialogDescription>{name} · 选择类型和目录</DialogDescription>
        </DialogHeader>
        <ToggleGroup
          value={[kind]}
          onValueChange={(values) => {
            if (values[0]) setKind(values[0] as "shell" | "codex");
          }}
          aria-label="Session 类型"
        >
          <ToggleGroupItem value="codex">Agent</ToggleGroupItem>
          <ToggleGroupItem value="shell">Shell</ToggleGroupItem>
        </ToggleGroup>
        <Field>
          <FieldLabel htmlFor="new-session-directory">目录</FieldLabel>
          <Input
            autoFocus
            id="new-session-directory"
            value={search}
            placeholder="搜索目录，↑↓ 选择，Enter 创建"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault();
                create();
              }
            }}
          />
        </Field>
        <div
          className="flex max-h-64 flex-col gap-1 overflow-y-auto"
          role="group"
          aria-label="可用目录"
        >
          {filtered.map((directory) => {
            const disabled =
              kind === "codex" &&
              (!directory.is_git || directory.git_status !== "ready");
            return (
              <Button
                key={directory.id}
                variant={active?.id === directory.id ? "secondary" : "ghost"}
                className="h-auto justify-start"
                disabled={disabled}
                aria-pressed={active?.id === directory.id}
                onClick={() => setSelected(directory.id)}
              >
                <span className="flex min-w-0 flex-col items-start">
                  <span>{directory.name}</span>
                  <span className="max-w-full truncate text-muted-foreground">
                    {directory.path}
                    {disabled ? " · Agent 需要可用的 Git 目录" : ""}
                  </span>
                </span>
              </Button>
            );
          })}
          {filtered.length === 0 && <p role="status">没有匹配的目录</p>}
        </div>
        <Button disabled={!active} onClick={create}>
          创建 Session
        </Button>
      </DialogContent>
    </Dialog>
  );
}

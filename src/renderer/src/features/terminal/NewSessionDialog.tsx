import { useLayoutEffect, useMemo, useRef, useState } from "react";
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
  const typeRefs = useRef<
    Partial<Record<"shell" | "codex", HTMLButtonElement | null>>
  >({});
  const searchRef = useRef<HTMLInputElement>(null);
  const searchReturnFocus = useRef<HTMLElement | null>(null);
  const restoreDirectoryFocus = useRef(false);
  const directoryRefs = useRef(new Map<string, HTMLButtonElement>());
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
  useLayoutEffect(() => {
    if (!restoreDirectoryFocus.current) return;
    restoreDirectoryFocus.current = false;
    const target = active
      ? directoryRefs.current.get(active.id)
      : typeRefs.current[kind];
    target?.focus();
  }, [kind, active?.id]);
  const leaveSearch = () => {
    const previous = searchReturnFocus.current;
    if (previous?.isConnected && !previous.matches(":disabled")) {
      previous.focus();
    } else {
      (active ? directoryRefs.current.get(active.id) : null)?.focus();
    }
    if (document.activeElement === searchRef.current) {
      typeRefs.current[kind]?.focus();
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (
          !open &&
          details.reason === "escape-key" &&
          document.activeElement === searchRef.current
        ) {
          details.cancel();
          leaveSearch();
          return;
        }
        if (!open) onClose();
      }}
    >
      <DialogContent
        initialFocus={() => typeRefs.current[kind] ?? null}
        onKeyDownCapture={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (
            event.metaKey &&
            !event.altKey &&
            !event.ctrlKey &&
            event.key.toLowerCase() === "f"
          ) {
            event.preventDefault();
            event.stopPropagation();
            searchRef.current?.focus();
            searchRef.current?.select();
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
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (active) directoryRefs.current.get(active.id)?.focus();
            } else if (event.key === "Enter") {
              event.preventDefault();
              create();
            }
          }}
          aria-label="Session 类型"
        >
          <ToggleGroupItem
            ref={(node) => { typeRefs.current.codex = node; }}
            value="codex"
            onFocus={() => setKind("codex")}
          >
            Agent
          </ToggleGroupItem>
          <ToggleGroupItem
            ref={(node) => { typeRefs.current.shell = node; }}
            value="shell"
            onFocus={() => setKind("shell")}
          >
            Shell
          </ToggleGroupItem>
        </ToggleGroup>
        <Field>
          <FieldLabel htmlFor="new-session-directory">目录</FieldLabel>
          <Input
            ref={searchRef}
            id="new-session-directory"
            value={search}
            placeholder="搜索目录（⌘ F）"
            onFocus={(event) => {
              if (event.relatedTarget instanceof HTMLElement) {
                searchReturnFocus.current = event.relatedTarget;
              }
            }}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (active) directoryRefs.current.get(active.id)?.focus();
                return;
              }
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
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              restoreDirectoryFocus.current = true;
              setKind(kind === "shell" ? "codex" : "shell");
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!available.length) return;
              const index = available.findIndex(
                (directory) => directory.id === active?.id,
              );
              const next = available[
                (index + (event.key === "ArrowDown" ? 1 : -1) + available.length) %
                available.length
              ];
              directoryRefs.current.get(next.id)?.focus();
            } else if (event.key === "Enter") {
              event.preventDefault();
              create();
            }
          }}
        >
          {filtered.map((directory) => {
            const disabled =
              kind === "codex" &&
              (!directory.is_git || directory.git_status !== "ready");
            return (
              <Button
                key={directory.id}
                ref={(node) => {
                  if (node) directoryRefs.current.set(directory.id, node);
                  else directoryRefs.current.delete(directory.id);
                }}
                tabIndex={active?.id === directory.id ? 0 : -1}
                onFocus={() => setSelected(directory.id)}
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

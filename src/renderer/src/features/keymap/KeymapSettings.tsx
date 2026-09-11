import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Keyboard, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionMenu, ActionMenuItem } from "@/components/app/ActionMenu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { keymapKey, keymapQuery, updateKeymap } from "./api";
import { keyboardChord } from "./keyboard";

export function KeymapSettings() {
  const query = useQuery(keymapQuery());
  const client = useQueryClient();
  const [recording, setRecording] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const save = async (bindings: Record<string, string | false | null>) => {
    setBusy(true);
    setError("");
    try {
      await client.cancelQueries({ queryKey: keymapKey });
      client.setQueryData(keymapKey, await updateKeymap(bindings));
      setRecording(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-5 p-6">
      <Field>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel htmlFor="keymap-search">快捷键 / Keymap</FieldLabel>
          <ActionMenu
            label="Keymap 操作"
            testId="keymap-actions"
            disabled={busy || !query.data}
          >
            <ActionMenuItem
              icon={<RotateCcw className="size-4" />}
              onClick={() => setResetOpen(true)}
            >
              恢复全部默认快捷键
            </ActionMenuItem>
          </ActionMenu>
        </div>
        <FieldDescription>
          点击录入后按组合键。cmd 与 super 等价；更改立即保存。Esc 取消录入。
        </FieldDescription>
        <Input
          id="keymap-search"
          placeholder="搜索命令或快捷键"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Field>
      {(error || query.error) && (
        <FieldError role="alert">{error || query.error?.message}</FieldError>
      )}
      {query.isPending && <p role="status">加载快捷键…</p>}
      {query.data?.commands
        .filter((command) =>
          `${command.id} ${command.label} ${command.binding}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
        .map((command) => (
          <div
            key={command.id}
            data-testid={`keymap-${command.id}`}
            className="flex items-center justify-between gap-4"
          >
            <Field className="min-w-0 flex-1">
              <FieldLabel>{command.label}</FieldLabel>
              <FieldDescription>{command.id}</FieldDescription>
            </Field>
            <div className="flex shrink-0 items-center gap-2">
              {recording === command.id ? (
                <Input
                  className="w-56"
                  autoFocus
                  readOnly
                  data-keymap-recording
                  aria-label={`录入 ${command.label}`}
                  value="请按组合键…"
                  aria-invalid={Boolean(error)}
                  onBlur={() => setRecording(null)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (
                      event.key === "Tab" &&
                      !event.ctrlKey &&
                      !event.metaKey &&
                      !event.altKey
                    ) {
                      setRecording(null);
                      return;
                    }
                    event.preventDefault();
                    if (event.key === "Escape") {
                      setRecording(null);
                      setError("");
                      return;
                    }
                    if (busy || event.repeat) return;
                    const chord = keyboardChord(event.nativeEvent);
                    if (chord) void save({ [command.id]: chord });
                  }}
                />
              ) : (
                <Button
                  variant="outline"
                  disabled={busy}
                  aria-label={`录入 ${command.label}`}
                  onClick={() => {
                    setError("");
                    setRecording(command.id);
                  }}
                >
                  <Keyboard data-icon="inline-start" />
                  {command.binding || "未绑定"}
                </Button>
              )}
              <ActionMenu
                label={`${command.label} 操作`}
                testId={`keymap-${command.id}-actions`}
                disabled={busy}
              >
                {command.binding !== false && (
                  <ActionMenuItem
                    icon={<X className="size-4" />}
                    onClick={() => void save({ [command.id]: false })}
                  >
                    禁用快捷键
                  </ActionMenuItem>
                )}
                <ActionMenuItem
                  icon={<RotateCcw className="size-4" />}
                  onClick={() => void save({ [command.id]: null })}
                >
                  恢复默认
                </ActionMenuItem>
              </ActionMenu>
            </div>
          </div>
        ))}
      <AlertDialog
        open={resetOpen}
        onOpenChange={(open) => {
          if (!busy) setResetOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>恢复全部默认快捷键？</AlertDialogTitle>
            <AlertDialogDescription>
              所有自定义绑定和禁用项都会恢复默认，并立即保存。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !query.data}
              onClick={() => {
                if (query.data)
                  void save(
                    Object.fromEntries(
                      query.data.commands.map((command) => [command.id, null]),
                    ),
                  ).then((ok) => {
                    if (ok) setResetOpen(false);
                  });
              }}
            >
              确认恢复
            </AlertDialogAction>
          </AlertDialogFooter>
          {error && <FieldError role="alert">{error}</FieldError>}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

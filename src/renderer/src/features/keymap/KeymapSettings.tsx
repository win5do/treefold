import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Keyboard, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  const save = async (id: string, binding: string | false | null) => {
    setBusy(true);
    setError("");
    try {
      await client.cancelQueries({ queryKey: keymapKey });
      client.setQueryData(keymapKey, await updateKeymap({ [id]: binding }));
      setRecording(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-5 p-6">
      <Field>
        <FieldLabel htmlFor="keymap-search">快捷键 / Keymap</FieldLabel>
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
          <Field key={command.id} data-testid={`keymap-${command.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FieldLabel>{command.label}</FieldLabel>
              <Badge variant="secondary">
                {command.binding === false
                  ? "已禁用"
                  : command.source === "default"
                    ? "默认"
                    : "自定义"}
              </Badge>
            </div>
            <FieldDescription>
              {command.id} · 默认 {command.default_binding}
            </FieldDescription>
            <div className="flex flex-wrap items-center gap-2">
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
                    if (chord) void save(command.id, chord);
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
              <Button
                variant="ghost"
                disabled={busy || command.binding === false}
                aria-label={`禁用 ${command.label}`}
                onClick={() => void save(command.id, false)}
              >
                <X data-icon="inline-start" />
                禁用
              </Button>
              <Button
                variant="ghost"
                disabled={busy || command.source === "default"}
                aria-label={`恢复默认 ${command.label}`}
                onClick={() => void save(command.id, null)}
              >
                <RotateCcw data-icon="inline-start" />
                恢复默认
              </Button>
            </div>
          </Field>
        ))}
    </div>
  );
}

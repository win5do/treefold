import { useTranslation } from "react-i18next";
import { keymapLabel } from "@/features/actions/labels";
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
import { keyboardChord, configuredChord, displayedChord } from "./keyboard";

export function KeymapSettings() {
  const { t } = useTranslation();
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
          <FieldLabel htmlFor="keymap-search">{t("keymapUi.keyboardShortcuts")}</FieldLabel>
          <ActionMenu
            label={t("keymapUi.keymapActions")}
            testId="keymap-actions"
            disabled={busy || !query.data}
          >
            <ActionMenuItem
              icon={<RotateCcw className="size-4" />}
              onClick={() => setResetOpen(true)}
            >{t("keymapUi.resetAllShortcuts")}</ActionMenuItem>
          </ActionMenu>
        </div>
        <FieldDescription>{t("keymapUi.recordingDescription")}</FieldDescription>
        <Input
          id="keymap-search"
          placeholder={t("keymapUi.searchCommandsOrShortcuts")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Field>
      {(error || query.error) && (
        <FieldError role="alert">{error || query.error?.message}</FieldError>
      )}
      {query.isPending && <p role="status">{t("keymapUi.loadingShortcuts")}</p>}
      {query.data?.commands
        .filter((command) =>
          `${command.id} ${command.label} ${keymapLabel(t, command.id, command.label)} ${command.binding} ${command.binding && configuredChord(command.binding)} ${command.binding && displayedChord(command.binding)}`
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
                  aria-label={t("keymapUi.record", { name: keymapLabel(t, command.id, command.label) })}
                  value={t("keymapUi.pressAKeyCombination")}
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
                    if (chord)
                      void save({ [command.id]: configuredChord(chord) });
                  }}
                />
              ) : (
                <Button
                  variant="outline"
                  disabled={busy}
                  aria-label={t("keymapUi.record", { name: keymapLabel(t, command.id, command.label) })}
                  onClick={() => {
                    setError("");
                    setRecording(command.id);
                  }}
                >
                  <Keyboard data-icon="inline-start" />
                  {command.binding ? displayedChord(command.binding) : t("keymapUi.unbound")}
                </Button>
              )}
              <ActionMenu
                label={t("keymapUi.actionsFor", { name: keymapLabel(t, command.id, command.label) })}
                testId={`keymap-${command.id}-actions`}
                disabled={busy}
              >
                {command.binding !== false && (
                  <ActionMenuItem
                    icon={<X className="size-4" />}
                    onClick={() => void save({ [command.id]: false })}
                  >{t("keymapUi.disableShortcut")}</ActionMenuItem>
                )}
                <ActionMenuItem
                  icon={<RotateCcw className="size-4" />}
                  onClick={() => void save({ [command.id]: null })}
                >{t("keymapUi.resetToDefault")}</ActionMenuItem>
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
            <AlertDialogTitle>{t("keymapUi.resetAllShortcuts2")}</AlertDialogTitle>
            <AlertDialogDescription>{t("keymapUi.resetDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("keymapUi.cancel")}</AlertDialogCancel>
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
            >{t("keymapUi.confirmReset")}</AlertDialogAction>
          </AlertDialogFooter>
          {error && <FieldError role="alert">{error}</FieldError>}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

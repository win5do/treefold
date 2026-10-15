import { useTranslation } from "react-i18next";
import { useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { actionLabel } from "./labels";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut } from "@/components/ui/command";
import { displayedChord } from "@/features/keymap/keyboard";
import type { Keymap } from "@/features/keymap/api";
import { actionScopes, type ActionInvocation, type PaletteEntry } from "./model";
import { searchPalette } from "./paletteSearch";
import type { ActionMenuRequest } from "./ActionMenu";

export function CommandPalette({ invocation, keymap, onClose, onOpenMenu }: {
  invocation: ActionInvocation;
  keymap?: Keymap;
  onClose: () => void;
  onOpenMenu: (entry: PaletteEntry, anchor: ActionMenuRequest["anchor"]) => void;
}) {
  const { t } = useTranslation();
  const executed = useRef(false);
  const items = useRef(new Map<string, HTMLDivElement>());
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const roots: PaletteEntry[] = invocation.actions
    .filter((action) => action.showInPalette !== false && action.available(invocation.context))
    .map((action) => ({
      id: action.id,
      actionId: action.id,
      name: action.name,
      label: actionLabel(t, action.id),
      scope: action.paletteScope?.(invocation.context) ?? action.scope,
      keymapId: action.keymapId,
      ...(action.children
        ? { children: () => action.children(invocation.context) }
        : { run: () => action.run(invocation.context) }),
    }));
  const entries = searchPalette(roots, query);
  const selectedEntry = entries.find((entry) => entry.id === selected) ?? entries[0];

  function select(entry: PaletteEntry) {
    if (executed.current) return;
    executed.current = true;
    const rect = items.current.get(entry.id)?.getBoundingClientRect();
    onClose();
    if (entry.children) {
      onOpenMenu(entry, { x: rect?.left ?? innerWidth / 2, y: rect?.bottom ?? innerHeight / 2 });
    } else {
      entry.run();
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden p-0 sm:max-w-3xl"
        finalFocus={() => executed.current ? false : invocation.returnFocus}
      >
        <DialogTitle className="sr-only">{t("actionsUi.commandPalette")}</DialogTitle>
        <DialogDescription className="sr-only">
          {invocation.context.workspace?.name ?? invocation.context.project?.name ?? t("actionsUi.global")}
        </DialogDescription>
        <Command loop shouldFilter={false} value={selectedEntry?.id ?? ""} onValueChange={setSelected}>
          <CommandInput autoFocus value={query} onValueChange={(value) => { setQuery(value); setSelected(""); }}
            aria-label={t("actionsUi.searchActions")} placeholder={t("actionsUi.searchActions2")} />
          <CommandList label={t("actionsUi.actions")}>
            <CommandEmpty>{t("actionsUi.noActionsFound")}</CommandEmpty>
            {actionScopes.map((scope) => {
              const group = entries.filter((entry) => entry.scope === scope);
              return group.length > 0 && (
                <CommandGroup key={scope} heading={t(`actionScopes.${scope}`)}>
                  {group.map((entry) => {
                    const binding = keymap?.commands.find((command) => command.id === entry.keymapId)?.binding;
                    return (
                      <CommandItem
                        key={entry.id}
                        ref={(element) => { if (element) items.current.set(entry.id, element); else items.current.delete(entry.id); }}
                        value={entry.id}
                        aria-label={entry.label}
                        aria-description={entry.actionId}
                        aria-haspopup={entry.children ? "menu" : undefined}
                        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_5rem]"
                        onSelect={() => select(entry)}
                      >
                        <span className="flex min-w-0 items-center gap-1">
                          <span className="truncate" title={entry.label}>{entry.label}</span>
                          {entry.children && <ChevronRight className="size-3 shrink-0" aria-hidden="true" />}
                        </span>
                        <span className="min-w-0 break-all text-muted-foreground">{entry.actionId}</span>
                        <CommandShortcut>{binding ? displayedChord(binding) : ""}</CommandShortcut>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
        <p className="px-3 py-2 text-xs text-muted-foreground">{t("actionsUi.keyboardHelp")}</p>
      </DialogContent>
    </Dialog>
  );
}

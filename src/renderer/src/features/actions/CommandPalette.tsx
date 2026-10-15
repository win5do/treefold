import { useTranslation } from "react-i18next";
import { useRef } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { actionLabel } from "./labels";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut } from "@/components/ui/command";
import { displayedChord } from "@/features/keymap/keyboard";
import type { Keymap } from "@/features/keymap/api";
import { actionScopes, type ActionInvocation, type PaletteEntry } from "./model";
import { usePaletteNavigation } from "./usePaletteNavigation";

export function CommandPalette({ invocation, keymap, onClose }: {
  invocation: ActionInvocation;
  keymap?: Keymap;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const executed = useRef(false);
  const input = useRef<HTMLInputElement>(null);
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
  const nav = usePaletteNavigation(roots, t("actionsUi.actions"));

  function execute(entry: PaletteEntry) {
    if (!entry.run || executed.current) return;
    executed.current = true;
    onClose();
    entry.run();
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
        {nav.canBack && (
          <div className="flex min-w-0 items-center gap-2 px-3 py-2">
            <Button variant="ghost" size="icon-sm" aria-label={t("actionsUi.back")}
              onClick={() => { nav.back(); input.current?.focus(); }}>
              <ArrowLeft data-icon="inline-start" />
            </Button>
            <span className="truncate text-muted-foreground" title={nav.path}>{nav.path}</span>
          </div>
        )}
        <Command
          key={nav.frame.id}
          loop
          shouldFilter={false}
          value={nav.selected?.id ?? ""}
          onValueChange={nav.select}
          onKeyDownCapture={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            const modified = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
            if (modified && event.key !== "Enter") return;
            if (!["ArrowRight", "ArrowLeft", "Enter"].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.repeat || modified) return;
            if (event.key === "ArrowLeft") nav.back();
            else if (nav.selected) {
              if (event.key === "ArrowRight") nav.enter(nav.selected);
              else execute(nav.selected);
            }
          }}
        >
          <CommandInput ref={input} autoFocus value={nav.frame.query} onValueChange={nav.search}
            aria-label={t("actionsUi.searchActions")} placeholder={t("actionsUi.searchActions2")} />
          <CommandList label={nav.frame.title} aria-busy={nav.frame.loading || undefined}>
            <CommandEmpty>
              {nav.frame.loading ? t("actionsUi.loading") : nav.frame.error ? t("actionsUi.loadFailed") : t("actionsUi.noActionsFound")}
            </CommandEmpty>
            {actionScopes.map((scope) => {
              const entries = nav.entries.filter((entry) => entry.scope === scope);
              return entries.length > 0 && (
                <CommandGroup key={scope} heading={nav.canBack ? undefined : t(`actionScopes.${scope}`)}>
                  {entries.map((entry) => {
                    const binding = keymap?.commands.find((command) => command.id === entry.keymapId)?.binding;
                    return (
                      <CommandItem
                        key={entry.id}
                        value={entry.id}
                        aria-label={entry.label}
                        aria-description={entry.actionId}
                        aria-keyshortcuts={entry.children ? "ArrowRight" : "Enter"}
                        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_5rem]"
                        onSelect={() => entry.children ? nav.enter(entry) : execute(entry)}
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
        {nav.frame.error && (
          <Button variant="ghost" onClick={() => { nav.retry(); input.current?.focus(); }}>
            {t("actionsUi.retry")}
          </Button>
        )}
        <p className="px-3 py-2 text-xs text-muted-foreground">{t("actionsUi.keyboardHelp")}</p>
      </DialogContent>
    </Dialog>
  );
}

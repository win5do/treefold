import { useTranslation } from "react-i18next";
import { useRef } from "react";
import { actionLabel } from "./labels";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import { displayedChord } from "@/features/keymap/keyboard";
import type { Keymap } from "@/features/keymap/api";
import { actionScopes, type ActionInvocation, type AppAction } from "./model";
export function CommandPalette({
  invocation,
  keymap,
  onClose,
}: {
  invocation: ActionInvocation;
  keymap?: Keymap;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const executed = useRef(false);
  function select(action: AppAction) {
    if (executed.current) return;
    executed.current = true;
    onClose();
    action.run(invocation.context);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden p-0"
        finalFocus={() => (executed.current ? false : invocation.returnFocus)}
      >
        <DialogTitle className="sr-only">{t("actionsUi.commandPalette")}</DialogTitle>
        <DialogDescription className="sr-only">
          {invocation.context.workspace?.name ??
            invocation.context.project?.name ??
            t("actionsUi.global")}
        </DialogDescription>
        <Command loop>
          <CommandInput
            autoFocus
            aria-label={t("actionsUi.searchActions")}
            placeholder={t("actionsUi.searchActions2")}
          />
          <CommandList aria-label={t("actionsUi.actions")}>
            <CommandEmpty>{t("actionsUi.noActionsFound")}</CommandEmpty>
            {actionScopes.map((scope) => {
              const actions = invocation.actions.filter(
                (action) =>
                  action.scope === scope &&
                  action.showInPalette !== false &&
                  action.available(invocation.context),
              );
              return (
                actions.length > 0 && (
                  <CommandGroup key={scope} heading={t(`actionScopes.${scope}`)}>
                    {actions.map((action) => {
                      const binding = keymap?.commands.find(
                        (command) => command.id === action.keymapId,
                      )?.binding;
                      return (
                        <CommandItem
                          key={action.id}
                          value={action.id}
                          keywords={[action.name, actionLabel(t, action.id)]}
                          onSelect={() => select(action)}
                        >
                          <span className="min-w-0 truncate">
                            {actionLabel(t, action.id)}
                          </span>
                          {binding && (
                            <CommandShortcut>
                              {displayedChord(binding)}
                            </CommandShortcut>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )
              );
            })}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

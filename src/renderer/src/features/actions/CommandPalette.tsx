import { useRef } from "react";
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
import type { ActionInvocation, ActionScope, AppAction } from "./model";

const scopes: ActionScope[] = [
  "global",
  "project",
  "workspace",
  "fork",
  "session",
];
export function CommandPalette({
  invocation,
  keymap,
  onClose,
}: {
  invocation: ActionInvocation;
  keymap?: Keymap;
  onClose: () => void;
}) {
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
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription className="sr-only">
          {invocation.context.workspace?.name ??
            invocation.context.project?.name ??
            "Global"}
        </DialogDescription>
        <Command loop>
          <CommandInput
            autoFocus
            aria-label="Search actions"
            placeholder="Search actions…"
          />
          <CommandList aria-label="Actions">
            <CommandEmpty>No actions found.</CommandEmpty>
            {scopes.map((scope) => {
              const actions = invocation.actions.filter(
                (action) =>
                  action.scope === scope &&
                  action.available(invocation.context),
              );
              return (
                actions.length > 0 && (
                  <CommandGroup key={scope} heading={scope}>
                    {actions.map((action) => {
                      const binding = keymap?.commands.find(
                        (command) => command.id === action.keymapId,
                      )?.binding;
                      return (
                        <CommandItem
                          key={action.id}
                          value={action.id}
                          keywords={[action.name]}
                          onSelect={() => select(action)}
                        >
                          <span className="min-w-0 truncate">
                            {action.name}
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

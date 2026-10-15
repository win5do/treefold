import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PaletteEntry } from "./model";

export type ActionMenuRequest = {
  entry: PaletteEntry;
  returnFocus: HTMLElement | null;
};

type ChoicesProps = {
  entry: PaletteEntry;
  open: boolean;
  focusOnLoad: boolean;
  onExecute: (entry: PaletteEntry) => void;
};

function MenuChoices({ entry, open, focusOnLoad, onExecute }: ChoicesProps) {
  const { t } = useTranslation();
  const firstItem = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ entries: PaletteEntry[]; loading: boolean; error: boolean }>({
    entries: [], loading: true, error: false,
  });
  useEffect(() => {
    if (!open || !entry.children) return;
    let active = true;
    setState({ entries: [], loading: true, error: false });
    Promise.resolve().then(() => entry.children!()).then(
      (entries) => { if (active) setState({ entries, loading: false, error: false }); },
      () => { if (active) setState({ entries: [], loading: false, error: true }); },
    );
    return () => { active = false; };
  }, [entry, open, attempt]);
  useEffect(() => {
    if (!open || !focusOnLoad || state.loading) return;
    // Let the menu register asynchronously loaded items before moving focus so
    // its roving keyboard selection starts on the same item as the DOM focus.
    const frame = requestAnimationFrame(() => firstItem.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, focusOnLoad, state]);

  return (
    <DropdownMenuGroup aria-busy={state.loading || undefined}>
      <DropdownMenuLabel>{entry.label}</DropdownMenuLabel>
      {state.loading && <DropdownMenuItem disabled>{t("actionsUi.loading")}</DropdownMenuItem>}
      {state.error && (
        <>
          <DropdownMenuItem disabled>{t("actionsUi.loadFailed")}</DropdownMenuItem>
          <DropdownMenuItem ref={firstItem} closeOnClick={false} onClick={() => setAttempt((value) => value + 1)}>
            {t("actionsUi.retry")}
          </DropdownMenuItem>
        </>
      )}
      {!state.loading && !state.error && state.entries.length === 0 && (
        <DropdownMenuItem disabled>{t("actionsUi.noActionsFound")}</DropdownMenuItem>
      )}
      {state.entries.map((choice, index) => choice.children ? (
        <NestedChoice key={choice.id} entry={choice} firstRef={index === 0 ? firstItem : undefined} onExecute={onExecute} />
      ) : (
        <DropdownMenuItem key={choice.id} ref={index === 0 ? firstItem : undefined}
          label={choice.label} onClick={() => onExecute(choice)}>
          <span className="truncate" title={choice.label}>{choice.label}</span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  );
}

function NestedChoice({ entry, firstRef, onExecute }: {
  entry: PaletteEntry;
  firstRef?: React.RefObject<HTMLDivElement | null>;
  onExecute: ChoicesProps["onExecute"];
}) {
  const [open, setOpen] = useState(false);
  const [focusOnLoad, setFocusOnLoad] = useState(false);
  return (
    <DropdownMenuSub open={open} closeParentOnEsc onOpenChange={(next, details) => {
      setFocusOnLoad(details.event.type === "keydown" ||
        (details.event instanceof MouseEvent && details.event.detail === 0));
      setOpen(next);
    }}>
      <DropdownMenuSubTrigger ref={firstRef} aria-label={entry.label}>
        <span className="min-w-0 truncate" title={entry.label}>{entry.label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent aria-label={entry.label} className="w-72 max-w-[calc(100vw-2rem)]">
        <MenuChoices entry={entry} open={open} focusOnLoad={focusOnLoad} onExecute={onExecute} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function ActionMenu({ request, onClose }: { request: ActionMenuRequest; onClose: () => void }) {
  const executed = useRef(false);
  function execute(entry: PaletteEntry) {
    if (!entry.run || executed.current) return;
    executed.current = true;
    onClose();
    entry.run();
  }
  return (
    <DropdownMenu open onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* Base UI registers the root floating-tree node through its trigger. The
          Palette trigger has unmounted; this menu is centered independently. */}
      <DropdownMenuTrigger hidden tabIndex={-1} aria-hidden />
      <DropdownMenuContent placement="center" aria-label={request.entry.label}
        className="w-72 max-w-[calc(100vw-2rem)]" finalFocus={() => request.returnFocus}>
        <MenuChoices entry={request.entry} open focusOnLoad onExecute={execute} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

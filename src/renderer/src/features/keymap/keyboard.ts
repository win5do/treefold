export function keyboardChord(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "metaKey"
    | "ctrlKey"
    | "altKey"
    | "shiftKey"
    | "isComposing"
    | "keyCode"
  >,
): string | null {
  if (event.isComposing || event.keyCode === 229) return null;
  let key = event.key.toLowerCase();
  if (["meta", "control", "alt", "shift", "dead", "unidentified"].includes(key))
    return null;
  if (key === " ") key = "space";
  if (key === "+") key = "plus";
  const modifiers = [
    event.metaKey && "super",
    event.ctrlKey && "ctrl",
    event.altKey && "alt",
    event.shiftKey && "shift",
  ].filter(Boolean);
  if (!event.metaKey && !event.ctrlKey && !event.altKey) return null;
  return [...modifiers, key].join("+");
}
export function shortcutOverlayOpen(): boolean {
  return Boolean(
    document.querySelector(
      '[role="dialog"]:not([data-closed]), [role="alertdialog"]:not([data-closed]), [role="menu"]:not([data-closed]), [data-keymap-recording]',
    ),
  );
}

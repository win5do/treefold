import type { Terminal } from "@xterm/xterm";

type ImeTerminal = Pick<Terminal, "input" | "onData" | "options" | "textarea">;
type ListenerHost = Pick<HTMLElement, "addEventListener" | "removeEventListener">;

type SetupXtermIme229WorkaroundOptions = {
  terminal: ImeTerminal;
  host: ListenerHost;
};

type PendingInsert = {
  data: string;
  delivered: boolean;
  timestamp: number;
};

const matchingKeyWindowMs = 100;

/**
 * Preserves native macOS IME punctuation commits instead of sending the
 * physical ASCII key before the input method can transform it. Also works
 * around xterm 6 dropping IME insertText events when printable
 * keys are reported as keyCode 229 outside a real composition session.
 *
 * The host capture listener prevents the affected keydown from reaching
 * xterm, which avoids both its stale keyDownSeen gate and its deferred
 * textarea diff fallback. If another overlapping key (for example Shift)
 * already made xterm drop the preceding input event, the public input API
 * replays that one insert exactly once.
 */
export function setupXtermIme229Workaround({
  terminal,
  host,
}: SetupXtermIme229WorkaroundOptions): () => void {
  const textarea = terminal.textarea;
  if (!textarea) return () => {};
  const isMac = navigator.platform.startsWith("Mac");

  let pendingInsert: PendingInsert | null = null;
  let nativePunctuation = false;

  const isTextareaEvent = (event: Event) => event.target === textarea;

  const clearPendingInsert = () => {
    pendingInsert = null;
    nativePunctuation = false;
  };

  const observedData = terminal.onData((data) => {
    if (pendingInsert?.data === data) pendingInsert.delivered = true;
  });

  const onInput = (event: Event) => {
    if (!isTextareaEvent(event) || !(event instanceof InputEvent)) return;
    if (nativePunctuation && !event.isComposing && event.inputType === "insertText" && event.data) {
      // Third-party macOS IMEs report the physical ASCII key at keydown,
      // then commit the actual punctuation through input (e.g. "." -> "。").
      // Shift may already have reached xterm, so its input gate cannot be used.
      clearPendingInsert();
      terminal.input(event.data, true);
      textarea.value = "";
      event.stopPropagation();
      return;
    }
    if (
      terminal.options.screenReaderMode ||
      !event.composed ||
      event.isComposing ||
      event.inputType !== "insertText" ||
      !event.data
    ) {
      clearPendingInsert();
      return;
    }
    pendingInsert = {
      data: event.data,
      delivered: false,
      timestamp: event.timeStamp,
    };
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isTextareaEvent(event)) return;
    if (
      isMac && !terminal.options.screenReaderMode && !event.isComposing && event.keyCode !== 229 &&
      !event.ctrlKey && !event.metaKey && !event.altKey &&
      /^[!-/:-@\[-`{-~]$/.test(event.key)
    ) {
      pendingInsert = null;
      nativePunctuation = true;
      // Allow the browser/IME default insertion, but not xterm's early send.
      event.stopPropagation();
      return;
    }
    const affectedPrintableKey =
      !terminal.options.screenReaderMode &&
      event.keyCode === 229 &&
      !event.isComposing &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey;
    if (!affectedPrintableKey) {
      clearPendingInsert();
      return;
    }

    const candidate = pendingInsert;
    const elapsed = candidate ? event.timeStamp - candidate.timestamp : Number.POSITIVE_INFINITY;
    if (
      candidate &&
      candidate.data === event.key &&
      elapsed >= 0 &&
      elapsed <= matchingKeyWindowMs &&
      !candidate.delivered
    ) {
      terminal.input(candidate.data, true);
    }
    clearPendingInsert();

    // Do not prevent the default action: some WebViews deliver keydown before
    // input, and the native insertion still needs to happen in that ordering.
    textarea.value = "";
    event.stopPropagation();
  };

  const clearForTextareaEvent = (event: Event) => {
    if (isTextareaEvent(event)) clearPendingInsert();
  };

  const onKeyPress = (event: KeyboardEvent) => {
    if (isTextareaEvent(event) && nativePunctuation) event.stopPropagation();
  };

  host.addEventListener("input", onInput, { capture: true });
  host.addEventListener("keydown", onKeyDown, { capture: true });
  host.addEventListener("keypress", onKeyPress, { capture: true });
  host.addEventListener("keyup", clearForTextareaEvent, { capture: true });
  host.addEventListener("compositionstart", clearForTextareaEvent, { capture: true });
  host.addEventListener("compositionend", clearForTextareaEvent, { capture: true });
  host.addEventListener("blur", clearForTextareaEvent, { capture: true });

  return () => {
    host.removeEventListener("input", onInput, { capture: true });
    host.removeEventListener("keydown", onKeyDown, { capture: true });
    host.removeEventListener("keypress", onKeyPress, { capture: true });
    host.removeEventListener("keyup", clearForTextareaEvent, { capture: true });
    host.removeEventListener("compositionstart", clearForTextareaEvent, { capture: true });
    host.removeEventListener("compositionend", clearForTextareaEvent, { capture: true });
    host.removeEventListener("blur", clearForTextareaEvent, { capture: true });
    observedData.dispose();
    clearPendingInsert();
  };
}

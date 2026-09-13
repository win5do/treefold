import type { Terminal } from "@xterm/xterm";

/** Reveal the scrollbar on activity even when the pointer stays over the terminal. */
export function setupTerminalScrollbar(terminal: Terminal) {
  const element = terminal.element!;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const reveal = () => {
    clearTimeout(hideTimer);
    element.dataset.scrollbarActive = "true";
    hideTimer = setTimeout(() => {
      delete element.dataset.scrollbarActive;
    }, 1000);
  };
  const scroll = terminal.onScroll(reveal);
  element.addEventListener("wheel", reveal, { passive: true });

  return () => {
    scroll.dispose();
    element.removeEventListener("wheel", reveal);
    clearTimeout(hideTimer);
    delete element.dataset.scrollbarActive;
  };
}

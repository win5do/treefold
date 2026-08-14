import { useEffect, useRef } from "react";
import { Bot, RotateCcw, Square, TerminalSquare, X } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { StatusDot } from "@/components/app/StatusDot";
import { Button } from "@/components/ui/button";
import type { Session } from "@/domain/types";

export function SessionWorkspace({ session, busy, onStop, onRestart, onClose, onExit }: { session: Session; busy: boolean; onStop: () => void; onRestart: () => void; onClose: () => void; onExit: () => void }) {
  const terminalState = ["exited", "failed", "closed", "evicted"].includes(session.status);
  return <div className="flex h-full min-h-0 flex-col bg-[#111315]">
    <div className="flex h-10 shrink-0 items-center border-b border-white/10 bg-[#191b1e] px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-neutral-200">{session.kind === "codex" ? <Bot className="size-3.5 shrink-0" /> : <TerminalSquare className="size-3.5 shrink-0" />}<span className="truncate font-medium">{session.name}</span><StatusDot status={session.status} /><span className="text-[10px] text-neutral-500">{session.status}</span></div>
      <div className="flex items-center gap-1 px-2">
        {session.kind === "shell" ? <Button size="sm" variant="terminal" disabled={busy} onClick={onClose}><X data-icon="inline-start" />Close Shell</Button> : terminalState ? <Button size="sm" variant="secondary" disabled={busy} onClick={onRestart}><RotateCcw data-icon="inline-start" />Resume</Button> : <Button size="sm" variant="terminal" disabled={busy} onClick={onStop}><Square data-icon="inline-start" />Stop</Button>}
      </div>
    </div>
    <WebTerminal key={session.id} session={session} onExit={onExit} />
  </div>;
}

function WebTerminal({ session, onExit }: { session: Session; onExit: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: '"SFMono-Regular", "JetBrains Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 10000,
      theme: {
        background: "#111315",
        foreground: "#e5e7eb",
        cursor: "#f5f5f5",
        selectionBackground: "#47556988",
        black: "#111315",
        brightBlack: "#6b7280",
        scrollbarSliderBackground: "#3f3f46",
        scrollbarSliderHoverBackground: "#52525b",
        scrollbarSliderActiveBackground: "#71717a",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(host);
    try { terminal.loadAddon(new WebglAddon()); } catch { /* canvas renderer is fine */ }
    fit.fit();
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(`ws://127.0.0.1:7331/api/sessions/${session.id}/terminal?takeover=true`);
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        fit.fit();
        socket?.send(JSON.stringify({ type: "resize", rows: terminal.rows, cols: terminal.cols }));
        terminal.focus();
      };
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) terminal.write(new Uint8Array(event.data));
        else if (typeof event.data === "string") {
          try {
            const message = JSON.parse(event.data) as { type?: string; code?: string };
            if (message.type === "exit") onExitRef.current();
            if (message.type === "error") terminal.writeln(`\r\n\x1b[31m${message.code || "terminal error"}\x1b[0m`);
          } catch { terminal.write(event.data); }
        }
      };
      socket.onclose = () => {
        if (!disposed && !["exited", "failed", "closed", "evicted"].includes(session.status)) reconnectTimer = window.setTimeout(connect, 1200);
      };
      socket.onerror = () => socket?.close();
    };
    const input = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data));
    });
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", rows: terminal.rows, cols: terminal.cols }));
    });
    resizeObserver.observe(host);
    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      resizeObserver.disconnect();
      input.dispose();
      socket?.close();
      terminal.dispose();
    };
  }, [session.id, session.status]);
  return <div ref={hostRef} className="min-h-0 flex-1 p-2" />;
}

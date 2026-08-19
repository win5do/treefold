import { useEffect, useRef } from "react";
import { Bot, PanelsTopLeft, RotateCcw, Square, TerminalSquare, X } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { sessionsApi } from "@/api/sessions";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "@azurity/pure-nerd-font/pure-nerd-font.css";
import { StatusDot } from "@/components/app/StatusDot";
import { Button } from "@/components/ui/button";
import type { Session } from "@/domain/types";
import { prepareTerminalInput } from "@/features/terminal/inputQueue";

const terminalFontFamily = '"SFMono-Regular", "JetBrains Mono", Menlo, "Pure Nerd Font", monospace';

export function SessionWorkspace({ session, busy, onStop, onRestart, onClose, onExit }: { session: Session; busy: boolean; onStop: () => void; onRestart: () => void; onClose: () => void; onExit: () => void }) {
  const running = session.status === "running";
  const icon = session.kind === "codex" ? <Bot className="size-3.5 shrink-0" /> : session.kind === "command" ? <PanelsTopLeft className="size-3.5 shrink-0" /> : <TerminalSquare className="size-3.5 shrink-0" />;
  return <div className="flex h-full min-h-0 flex-col bg-[#111315]">
    <div className="flex h-10 shrink-0 items-center border-b border-white/10 bg-[#191b1e] px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-neutral-200">{icon}<span className="truncate font-medium">{session.name}</span><StatusDot status={session.status} /><span className="text-[10px] text-neutral-500">{session.status}</span></div>
      <div className="flex items-center gap-1 px-2">
        {running ? <Button size="sm" variant="terminal" disabled={busy} onClick={onStop}><Square data-icon="inline-start" />Stop</Button> : <Button size="sm" variant="secondary" disabled={busy || (session.kind === "codex" && !session.codex_session_id)} onClick={onRestart}><RotateCcw data-icon="inline-start" />Restart</Button>}
        <Button size="icon-sm" variant="terminal" disabled={busy} aria-label="Close Session" title="Close Session" onClick={onClose}><X /></Button>
      </div>
    </div>
    {running ? <WebTerminal key={session.id} session={session} onExit={onExit} /> : <div data-testid="session-terminal-state" className="grid min-h-0 flex-1 place-items-center p-8 text-neutral-300"><div className="w-full max-w-2xl rounded-lg border border-white/10 bg-white/[0.03] p-5"><p className="text-sm font-medium">Session is {session.status}</p><dl className="mt-4 grid gap-3 text-xs"><div><dt className="text-neutral-500">Command</dt><dd className="mt-1 break-all font-mono">{session.argv.join(" ") || "—"}</dd></div><div><dt className="text-neutral-500">Working directory</dt><dd className="mt-1 break-all font-mono">{session.cwd}</dd></div><div><dt className="text-neutral-500">I/O mode</dt><dd className="mt-1 font-mono">{session.io_mode}</dd></div></dl></div></div>}
  </div>;
}

function WebTerminal({ session, onExit }: { session: Session; onExit: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: terminalFontFamily,
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
    void document.fonts.load('13px "Pure Nerd Font"').then(() => {
      if (disposed) return;
      terminal.clearTextureAtlas();
      terminal.refresh(0, terminal.rows - 1);
    }).catch(() => { /* existing font fallbacks remain available */ });
    fit.fit();
    const socketHighWaterBytes = 256 * 1024;
    const pendingInput: ArrayBuffer[] = [];
    let pendingBytes = 0;
    let inputPaused = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let flushTimer = 0;
    let resizeFrame = 0;
    let reconnectAttempt = 0;
    let generation = 0;
    let controllerId: number | null = null;
    let lastRows = 0;
    let lastCols = 0;

    const sendResize = (candidate: WebSocket, force = false) => {
      fit.fit();
      if (!force && terminal.rows === lastRows && terminal.cols === lastCols) return;
      lastRows = terminal.rows;
      lastCols = terminal.cols;
      if (candidate.readyState === WebSocket.OPEN) {
        candidate.send(JSON.stringify({ type: "resize", rows: terminal.rows, cols: terminal.cols }));
      }
    };

    const scheduleFlush = (flush: () => void) => {
      if (flushTimer || disposed) return;
      flushTimer = window.setTimeout(() => {
        flushTimer = 0;
        flush();
      }, 16);
    };

    const flushInput = () => {
      const candidate = socket;
      if (!candidate || candidate.readyState !== WebSocket.OPEN) return;
      while (pendingInput.length > 0 && candidate.bufferedAmount < socketHighWaterBytes) {
        const data = pendingInput.shift()!;
        pendingBytes -= data.byteLength;
        candidate.send(data);
      }
      if (pendingInput.length > 0) scheduleFlush(flushInput);
      else if (inputPaused) {
        inputPaused = false;
        terminal.options.disableStdin = false;
      }
    };

    const scheduleReconnect = (connect: () => void) => {
      if (reconnectTimer || disposed || session.status !== "running") return;
      const baseDelay = Math.min(4_000, 250 * 2 ** reconnectAttempt++);
      const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = 0;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      const candidate = new WebSocket(sessionsApi.terminalSocketUrl(session.id));
      const candidateGeneration = ++generation;
      let relinquished = false;
      socket = candidate;
      candidate.binaryType = "arraybuffer";
      candidate.onopen = () => {
        if (disposed || socket !== candidate || generation !== candidateGeneration) return;
        reconnectAttempt = 0;
        controllerId = null;
        sendResize(candidate, true);
        flushInput();
        terminal.focus();
      };
      candidate.onmessage = (event) => {
        if (disposed || socket !== candidate || generation !== candidateGeneration) return;
        if (event.data instanceof ArrayBuffer) terminal.write(new Uint8Array(event.data));
        else if (typeof event.data === "string") {
          try {
            const message = JSON.parse(event.data) as { type?: string; code?: string; controller?: number };
            if (message.type === "exit") onExitRef.current();
            if (message.type === "error") terminal.writeln(`\r\n\x1b[31m${message.code || "terminal error"}\x1b[0m`);
            if (message.type === "input_error") {
              terminal.writeln("\r\n\x1b[31mterminal input failed; reconnecting\x1b[0m");
              candidate.close();
            }
            if (message.type === "ownership_changed" && typeof message.controller === "number") {
              if (controllerId === null) controllerId = message.controller;
              else if (controllerId !== message.controller) {
                relinquished = true;
                inputPaused = true;
                terminal.options.disableStdin = true;
                terminal.writeln("\r\n\x1b[33mterminal control moved to another window\x1b[0m");
                socket = null;
                candidate.close();
              }
            }
          } catch { terminal.write(event.data); }
        }
      };
      candidate.onclose = () => {
        if (socket === candidate) socket = null;
        if (!relinquished && generation === candidateGeneration) scheduleReconnect(connect);
      };
      candidate.onerror = () => candidate.close();
    };
    const input = terminal.onData((data) => {
      const prepared = prepareTerminalInput(data, pendingBytes);
      if (!prepared.accepted && prepared.reason === "single-input-too-large") {
        terminal.writeln("\r\n\x1b[31mterminal input rejected: a single paste cannot exceed 1 MiB\x1b[0m");
        return;
      }
      if (!prepared.accepted) {
        if (!inputPaused) {
          inputPaused = true;
          terminal.options.disableStdin = true;
          terminal.writeln("\r\n\x1b[31mterminal input paused: reconnect buffer is full\x1b[0m");
        }
        return;
      }
      for (const frame of prepared.frames) {
        pendingInput.push(frame);
        pendingBytes += frame.byteLength;
      }
      flushInput();
    });
    const resizeObserver = new ResizeObserver(() => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        const candidate = socket;
        if (candidate) sendResize(candidate);
      });
    });
    resizeObserver.observe(host);
    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(flushTimer);
      window.cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      input.dispose();
      socket?.close();
      terminal.dispose();
    };
  }, [session.id, session.status]);
  return <div ref={hostRef} className="min-h-0 flex-1 p-2" />;
}

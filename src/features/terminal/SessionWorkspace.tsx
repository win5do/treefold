import { useEffect, useRef, useState } from "react";
import { Bot, PanelsTopLeft, RotateCcw, Square, TerminalSquare, X } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { logStreamState } from "@/api/client";
import { sessionsApi } from "@/api/sessions";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "@azurity/pure-nerd-font/pure-nerd-font.css";
import { StatusDot } from "@/components/app/StatusDot";
import { Button } from "@/components/ui/button";
import type { Session } from "@/domain/types";
import { acceptOutputSequence, createTerminalRuntime, decodeSequencedOutput, type TerminalOwnership, type TerminalRuntime } from "@/features/terminal/runtime";
import { setupXtermIme229Workaround } from "@/features/terminal/xtermIme229Workaround";

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
  const runtimeRef = useRef<TerminalRuntime | null>(null);
  if (!runtimeRef.current) runtimeRef.current = createTerminalRuntime();
  const [ownership, setOwnership] = useState<TerminalOwnership>(runtimeRef.current.ownership);
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
    const disposeIme229Workaround = setupXtermIme229Workaround({ terminal, host });
    try { terminal.loadAddon(new WebglAddon()); } catch { /* canvas renderer is fine */ }
    void document.fonts.load('13px "Pure Nerd Font"').then(() => {
      if (disposed) return;
      terminal.clearTextureAtlas();
      terminal.refresh(0, terminal.rows - 1);
    }).catch(() => { /* existing font fallbacks remain available */ });
    fit.fit();
    const socketHighWaterBytes = 256 * 1024;
    const runtime = runtimeRef.current!;
    const { inputClientId, inputQueue } = runtime;
    runtime.ownership = "connecting";
    setOwnership("connecting");
    terminal.options.disableStdin = true;
    let inputPaused = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let flushTimer = 0;
    let resizeFrame = 0;
    let reconnectAttempt = 0;
    let generation = 0;
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
      while (inputQueue.hasUnsent && candidate.bufferedAmount < socketHighWaterBytes) {
        const frame = inputQueue.takeUnsent();
        if (!frame) break;
        try {
          candidate.send(frame.wire);
        } catch {
          inputQueue.reconnect();
          candidate.close();
          return;
        }
      }
      if (inputQueue.hasUnsent) scheduleFlush(flushInput);
      else if (inputPaused && !inputQueue.shouldPauseStdin) {
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
      const candidateUrl = sessionsApi.terminalSocketUrl(
        session.id,
        runtime.controllerClientId,
        inputClientId,
        runtime.lastOutputSequence,
      );
      const candidate = new WebSocket(candidateUrl);
      const candidateGeneration = ++generation;
      socket = candidate;
      candidate.binaryType = "arraybuffer";
      candidate.onopen = () => {
        logStreamState(candidateUrl, "open");
        if (disposed || socket !== candidate || generation !== candidateGeneration) return;
        reconnectAttempt = 0;
        inputQueue.reconnect();
      };
      candidate.onmessage = (event) => {
        if (disposed || socket !== candidate || generation !== candidateGeneration) return;
        if (event.data instanceof ArrayBuffer) {
          const output = decodeSequencedOutput(event.data);
          if (output && acceptOutputSequence(runtime, output.sequence)) terminal.write(output.data);
        }
        else if (typeof event.data === "string") {
          try {
            const message = JSON.parse(event.data) as { type?: string; state?: TerminalOwnership; code?: string; client_id?: string; sequence?: number | string };
            if (message.type === "exit") onExitRef.current();
            if (message.type === "error") terminal.writeln(`\r\n\x1b[31m${message.code || "terminal error"}\x1b[0m`);
            if (message.type === "input_ack" && message.client_id === inputClientId && typeof message.sequence === "number") {
              inputQueue.acknowledge(message.sequence);
              flushInput();
            }
            if (message.type === "output_cursor" && typeof message.sequence === "string" && runtime.lastOutputSequence === null) {
              runtime.lastOutputSequence = BigInt(message.sequence);
            }
            if (message.type === "output_gap" && !runtime.gapNotified) {
              runtime.gapNotified = true;
              terminal.writeln("\r\n\x1b[33mterminal output history has a gap; resumed from the earliest available output\x1b[0m");
            }
            if (message.type === "ownership_state" && message.state === "controller") {
              runtime.ownership = "controller";
              setOwnership("controller");
              inputPaused = inputQueue.shouldPauseStdin;
              terminal.options.disableStdin = inputPaused;
              sendResize(candidate, true);
              flushInput();
              terminal.focus();
            }
            if (message.type === "ownership_state" && message.state === "readonly") {
              runtime.ownership = "readonly";
              setOwnership("readonly");
              inputPaused = true;
              terminal.options.disableStdin = true;
            }
            if (message.type === "input_rejected" && message.code !== "ownership_lost") {
              terminal.writeln(`\r\n\x1b[31mterminal input rejected: ${message.code || "protocol error"}; reconnecting\x1b[0m`);
              candidate.close();
            }
            if (message.type === "input_rejected" && message.code === "ownership_lost") candidate.close();
            if (message.type === "input_error") {
              terminal.writeln("\r\n\x1b[31mterminal input failed; reconnecting\x1b[0m");
              candidate.close();
            }
          } catch { /* protocol control frames are JSON */ }
        }
      };
      candidate.onclose = () => {
        logStreamState(candidateUrl, "closed");
        if (socket === candidate) socket = null;
        inputQueue.reconnect();
        if (generation === candidateGeneration) scheduleReconnect(connect);
      };
      candidate.onerror = () => {
        logStreamState(candidateUrl, "error");
        candidate.close();
      };
    };
    const input = terminal.onData((data) => {
      if (runtime.ownership !== "controller") return;
      const prepared = inputQueue.enqueue(data);
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
      if (prepared.pauseStdin && !inputPaused) {
        inputPaused = true;
        terminal.options.disableStdin = true;
        terminal.writeln("\r\n\x1b[33mterminal input paused until queued input is acknowledged\x1b[0m");
      }
      flushInput();
    });
    const resizeObserver = new ResizeObserver(() => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        const candidate = socket;
        if (candidate && runtime.ownership === "controller") sendResize(candidate);
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
      disposeIme229Workaround();
      input.dispose();
      socket?.close();
      terminal.dispose();
    };
  }, [session.id, session.status]);
  return <div className="relative min-h-0 flex-1">
    {ownership === "readonly" ? <div data-testid="terminal-readonly-indicator" role="status" className="absolute right-4 top-3 z-10 rounded border border-amber-400/30 bg-[#191b1e]/95 px-2 py-1 text-[10px] font-medium text-amber-300">Read only</div> : null}
    <div ref={hostRef} className="h-full min-h-0 p-2" />
  </div>;
}

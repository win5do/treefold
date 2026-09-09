import { desktop } from "@/lib/desktop"

function errorDetails(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.stack || `${cause.name}: ${cause.message}`
  }
  if (typeof cause === "string") return cause
  try {
    return JSON.stringify(cause)
  } catch {
    return String(cause)
  }
}

function write(level: "debug" | "info" | "warn" | "error", message: string, cause?: unknown) {
  const rendered = cause === undefined ? message : `${message}\n${errorDetails(cause)}`
  console[level](rendered)
  if (desktop) {
    void desktop.log(level, rendered).catch((error) => console.error("Failed to write desktop log", error))
  }
}

export const frontendLogger = {
  debug: (message: string) => write("debug", message),
  info: (message: string) => write("info", message),
  warn: (message: string, cause?: unknown) => write("warn", message, cause),
  error: (message: string, cause?: unknown) => write("error", message, cause),
}

export function installGlobalErrorLogging() {
  window.addEventListener("error", (event) => {
    frontendLogger.error("Uncaught WebView error", event.error ?? event.message)
  })
  window.addEventListener("unhandledrejection", (event) => {
    frontendLogger.error("Unhandled WebView promise rejection", event.reason)
  })
}

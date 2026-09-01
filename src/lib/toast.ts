import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import type { ComponentPropsWithoutRef } from "react"

import { ApiError } from "@/api/client"
import { appApi } from "@/api/app"
import { frontendLogger } from "@/lib/logger"

export const toastManager = ToastPrimitive.createToastManager()

type ToastOptions = {
  description?: string
  timeout?: number
  actionProps?: ComponentPropsWithoutRef<"button">
}

function openRuntimeLogs() {
  void appApi.revealLogs().catch((cause) => {
    const message = cause instanceof Error ? cause.message : "Could not open runtime logs"
    frontendLogger.error("Could not open runtime logs", cause)
    toastManager.add({ title: message, type: "error", timeout: 4_000 })
  })
}

export const toast = {
  success(title: string, options: ToastOptions = {}) {
    return toastManager.add({ title, type: "success", timeout: 1_800, ...options })
  },
  error(title: string, options: ToastOptions = {}) {
    return toastManager.add({ title, type: "error", timeout: 3_000, ...options })
  },
  errorFrom(cause: unknown, fallback = "Treefold encountered an unexpected error") {
    const message = cause instanceof Error ? cause.message : fallback
    const internal = cause instanceof ApiError && cause.code === "INTERNAL_ERROR"
    if (!(cause instanceof ApiError) || ["NETWORK_ERROR", "INVALID_RESPONSE", "HTTP_ERROR"].includes(cause.code)) {
      frontendLogger.error(message, cause)
    }
    return toastManager.add({
      title: message,
      type: "error",
      timeout: internal ? 10_000 : 4_000,
      actionProps: internal
        ? { children: "Open logs", onClick: openRuntimeLogs }
        : undefined,
    })
  },
  info(title: string, options: ToastOptions = {}) {
    return toastManager.add({ title, type: "info", timeout: 3_000, ...options })
  },
  warning(title: string, options: ToastOptions = {}) {
    return toastManager.add({ title, type: "warning", timeout: 4_000, ...options })
  },
}

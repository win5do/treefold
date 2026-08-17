import { Toast as ToastPrimitive } from "@base-ui/react/toast"

export const toastManager = ToastPrimitive.createToastManager()

type ToastOptions = {
  description?: string
  timeout?: number
}

export const toast = {
  success(title: string, options: ToastOptions = {}) {
    return toastManager.add({ title, type: "success", timeout: 1_800, ...options })
  },
  error(title: string, options: ToastOptions = {}) {
    return toastManager.add({ title, type: "error", timeout: 3_000, ...options })
  },
  info(title: string, options: ToastOptions = {}) {
    return toastManager.add({ title, type: "info", timeout: 3_000, ...options })
  },
  warning(title: string, options: ToastOptions = {}) {
    return toastManager.add({ title, type: "warning", timeout: 4_000, ...options })
  },
}

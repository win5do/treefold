import { Toast as ToastPrimitive } from "@base-ui/react/toast"

export const noticeManager = ToastPrimitive.createToastManager()

type NoticeOptions = {
  description?: string
  timeout?: number
}

export const notice = {
  success(title: string, options: NoticeOptions = {}) {
    return noticeManager.add({ title, type: "success", timeout: 1_800, ...options })
  },
  error(title: string, options: NoticeOptions = {}) {
    return noticeManager.add({ title, type: "error", timeout: 3_000, ...options })
  },
  info(title: string, options: NoticeOptions = {}) {
    return noticeManager.add({ title, type: "info", timeout: 3_000, ...options })
  },
  warning(title: string, options: NoticeOptions = {}) {
    return noticeManager.add({ title, type: "warning", timeout: 4_000, ...options })
  },
}

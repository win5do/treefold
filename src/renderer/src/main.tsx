import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { desktop } from "@/lib/desktop";
import { HashRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";
import "./i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toast";
import { applyThemePreference } from "@/lib/theme";
import { setApiBase } from "@/api/client";
import { RuntimeSync } from "@/features/app/RuntimeSync";
import { frontendLogger, installGlobalErrorLogging } from "@/lib/logger";
import { queryClient } from "@/features/app/queryClient";

applyThemePreference("system");
installGlobalErrorLogging();

if (desktop) {
  document.addEventListener("contextmenu", (event) => {
    const keepsNativeEditingMenu = event.composedPath().some(
      (target) =>
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable),
    );
    if (!keepsNativeEditingMenu) {
      event.preventDefault();
    }
  });

  if (!import.meta.env.VITE_TREEFOLD_API_BASE) {
    setApiBase(await desktop.apiUrl());
  }
}

createRoot(document.getElementById("root")!, {
  onUncaughtError(error, errorInfo) {
    frontendLogger.error(
      `Uncaught React error${errorInfo.componentStack ?? ""}`,
      error,
    );
  },
  onRecoverableError(error, errorInfo) {
    frontendLogger.warn(
      `Recoverable React error${errorInfo.componentStack ?? ""}`,
      error,
    );
  },
}).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RuntimeSync />
      <TooltipProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </TooltipProvider>
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);

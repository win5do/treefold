import { focusManager, QueryClient } from "@tanstack/react-query";

// Returning from another desktop app need not change document visibility.
focusManager.setEventListener((onFocus) => {
  const focus = () => onFocus(true);
  const blur = () => onFocus(false);
  const visibility = () => onFocus(document.visibilityState !== "hidden");
  window.addEventListener("focus", focus);
  window.addEventListener("blur", blur);
  window.addEventListener("visibilitychange", visibility);
  return () => {
    window.removeEventListener("focus", focus);
    window.removeEventListener("blur", blur);
    window.removeEventListener("visibilitychange", visibility);
  };
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 3_000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

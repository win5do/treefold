import type { ThemePreference } from "@/domain/types";

const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

export function applyThemePreference(preference: ThemePreference) {
  const dark = preference === "dark"
    || (preference === "system" && window.matchMedia(DARK_MODE_QUERY).matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function watchSystemTheme(preference: ThemePreference) {
  applyThemePreference(preference);
  if (preference !== "system") return () => {};
  const media = window.matchMedia(DARK_MODE_QUERY);
  const update = () => applyThemePreference("system");
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}

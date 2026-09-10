import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { enUS } from "./locales/en-US";
import { zhCN } from "./locales/zh-CN";

export const LANGUAGE_PREFERENCES = ["system", "en-US", "zh-CN"] as const;
export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number];
export type SupportedLanguage = Exclude<LanguagePreference, "system">;

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages.length > 0 ? navigator.languages : [navigator.language];
}

export function resolveLanguage(
  preference: LanguagePreference,
  systemLanguages: readonly string[] = browserLanguages(),
): SupportedLanguage {
  if (preference !== "system") return preference;
  return systemLanguages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh-CN" : "en-US";
}

export async function applyLanguage(preference: LanguagePreference): Promise<SupportedLanguage> {
  const language = resolveLanguage(preference);
  await i18n.changeLanguage(language);
  if (typeof document !== "undefined") document.documentElement.lang = language;
  return language;
}

void i18n.use(initReactI18next).init({
  resources: {
    "en-US": { translation: enUS },
    "zh-CN": { translation: zhCN },
  },
  lng: resolveLanguage("system"),
  fallbackLng: "en-US",
  supportedLngs: ["en-US", "zh-CN"],
  load: "currentOnly",
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

if (typeof document !== "undefined") document.documentElement.lang = i18n.language;

export default i18n;

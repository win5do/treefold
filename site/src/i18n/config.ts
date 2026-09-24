import { getRelativeLocaleUrl } from 'astro:i18n';

export const locales = ['zh-cn', 'en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'zh-cn';

export const localeMeta = {
  'zh-cn': {
    htmlLang: 'zh-CN',
    hreflang: 'zh-CN',
  },
  en: {
    htmlLang: 'en',
    hreflang: 'en',
  },
} as const satisfies Record<Locale, { htmlLang: string; hreflang: string }>;

const alternateLocales = {
  'zh-cn': 'en',
  en: 'zh-cn',
} as const satisfies Record<Locale, Locale>;

export type SiteRoute = 'home' | 'download';

const routePaths = {
  home: '',
  download: 'download',
} as const satisfies Record<SiteRoute, string>;

export function normalizeLocale(locale: string | undefined): Locale {
  return locales.includes(locale as Locale) ? (locale as Locale) : defaultLocale;
}

export function getAlternateLocale(locale: Locale): Locale {
  return alternateLocales[locale];
}

export function getLocalizedPath(locale: Locale, route: SiteRoute): string {
  return getRelativeLocaleUrl(locale, routePaths[route]);
}

/**
 * Localisation.
 *
 * English is the source of truth; de and vi fall back to it per key, so a
 * missing translation degrades to English rather than to an empty label.
 *
 * Language is independent of the mounted pack — a German speaker uses the
 * Vietnam pack with a German interface. Scientific names are never
 * translated in any language; they are the universal key.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import de from './locales/de.json'
import vi from './locales/vi.json'

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'vi', name: 'Tiếng Việt' },
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

const KEY = 'spidex.lang'

/**
 * English-first: an explicit choice always wins, and everyone else starts in
 * English. Browser locale is deliberately NOT consulted. Pack content is
 * authored in English and falls back to it per field, so a browser-matched
 * Vietnamese interface over a partly-English pack produced a screen in two
 * languages at once — worse than a screen consistently in one.
 *
 * The language switcher in the drawer is the way to Vietnamese or German, and
 * the choice persists from then on.
 */
function initialLanguage(): LanguageCode {
  try {
    const saved = globalThis.localStorage?.getItem(KEY) as LanguageCode | null
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved
  } catch { /* private mode */ }
  return 'en'
}

void i18n.use(initReactI18next).init({
  resources: { en: { t: en }, de: { t: de }, vi: { t: vi } },
  ns: ['t'],
  defaultNS: 't',
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnEmptyString: false,
})

syncDocumentLang(i18n.language as LanguageCode)

export function setLanguage(code: LanguageCode): void {
  void i18n.changeLanguage(code)
  try { globalThis.localStorage?.setItem(KEY, code) } catch { /* private mode */ }
  syncDocumentLang(code)
}

/**
 * Reflect the language on <html lang>, which drives the Vietnamese
 * line-height rule in base.css. Guarded: the data layer imports this module
 * for its resolver, and that must not require a DOM.
 */
function syncDocumentLang(code: LanguageCode): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = code
}

export default i18n

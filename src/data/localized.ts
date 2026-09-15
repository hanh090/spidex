/**
 * Per-field fallback for pack content.
 *
 * A pack will realistically carry English key features long before German
 * ones, so resolution falls back field by field — never per language, which
 * would drop a fully-translated common name because one bullet was missing.
 *
 * Content falls back silently. UI chrome does not (see src/i18n): a missing
 * interface string is a build problem, not a runtime one.
 */
import type { LocalizedText } from './pack-manifest'
import i18n from '../i18n'

export function resolve(text: LocalizedText | undefined, lang?: string): string {
  if (!text) return ''
  const code = (lang ?? i18n.language ?? 'en').slice(0, 2) as keyof LocalizedText
  return text[code] || text.en
}

export function resolveAll(list: LocalizedText[] | undefined, lang?: string): string[] {
  return (list ?? []).map((t) => resolve(t, lang))
}


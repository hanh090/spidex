/**
 * Theme selection.
 *
 * Day and Night follow the system. Sun and Dawn are manual only — Dawn in
 * particular must never be auto-applied, because a red-shifted UI appearing
 * unrequested reads as a fault, not a feature.
 */
export type Theme = 'day' | 'night' | 'sun' | 'dawn'
export type ThemeSetting = Theme | 'system'

export const THEMES: { id: ThemeSetting; labelKey: string; auto: boolean }[] = [
  { id: 'system', labelKey: 'theme.system', auto: true },
  { id: 'day', labelKey: 'theme.day', auto: true },
  { id: 'night', labelKey: 'theme.night', auto: true },
  { id: 'sun', labelKey: 'theme.sun', auto: false },
  { id: 'dawn', labelKey: 'theme.dawn', auto: false },
]

const KEY = 'spidex.theme'

export function readThemeSetting(): ThemeSetting {
  try {
    const v = localStorage.getItem(KEY) as ThemeSetting | null
    return v && THEMES.some((t) => t.id === v) ? v : 'system'
  } catch {
    return 'system'
  }
}

export function writeThemeSetting(v: ThemeSetting): void {
  try { localStorage.setItem(KEY, v) } catch { /* private mode: session-only */ }
}

/** Resolve a setting to the theme actually painted. */
export function resolveTheme(setting: ThemeSetting): Theme {
  if (setting !== 'system') return setting
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  return dark ? 'night' : 'day'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  // Match the browser chrome to the app so the status bar does not fight it.
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim()
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', bg || '#f0ebe1')
}

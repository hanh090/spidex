/**
 * Theme selection.
 *
 * Day and Night follow the system. Sun and Dawn are manual only — Dawn in
 * particular must never be auto-applied, because a red-shifted UI appearing
 * unrequested reads as a fault, not a feature.
 */
export type Theme = 'day' | 'night' | 'sun' | 'dawn'
export type ThemeSetting = Theme | 'system'

/**
 * `swatch` is [ground, ink, accent], lifted from the theme's own tokens. The
 * picker shows it beside each name: Sun and Dawn are functional choices about
 * glare and dark adaptation, and a row of words gives no sense of what they
 * do. `null` for system, which has no fixed colours of its own.
 */
export const THEMES: {
  id: ThemeSetting
  labelKey: string
  auto: boolean
  swatch: [string, string, string] | null
}[] = [
  { id: 'system', labelKey: 'theme.system', auto: true, swatch: null },
  { id: 'day', labelKey: 'theme.day', auto: true, swatch: ['#faf7f2', '#141110', '#b8232c'] },
  { id: 'night', labelKey: 'theme.night', auto: true, swatch: ['#1c1917', '#f2ece1', '#d9535c'] },
  { id: 'sun', labelKey: 'theme.sun', auto: false, swatch: ['#ffffff', '#000000', '#96101a'] },
  { id: 'dawn', labelKey: 'theme.dawn', auto: false, swatch: ['#120705', '#e8968a', '#ff6b5a'] },
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

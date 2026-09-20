/**
 * Touch density — the field-ergonomics control.
 *
 * 'field' raises every tap target past the already-raised floor (48/56 →
 * 56/64) for gloved and one-handed use, pairing with the Sun theme's glare
 * contrast. It is a manual setting, like Dawn: a UI that suddenly grows
 * reads as a defect when it was not asked for.
 */
export type Density = 'standard' | 'field'

const KEY = 'spidex.density'

export function readDensitySetting(): Density {
  try {
    return localStorage.getItem(KEY) === 'field' ? 'field' : 'standard'
  } catch {
    return 'standard'
  }
}

export function writeDensitySetting(v: Density): void {
  try { localStorage.setItem(KEY, v) } catch { /* private mode: session-only */ }
}

export function applyDensity(d: Density): void {
  document.documentElement.dataset.density = d
}

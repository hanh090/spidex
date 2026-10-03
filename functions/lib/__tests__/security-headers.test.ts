import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const file = readFileSync(new URL('../../../public/_headers', import.meta.url), 'utf8')

/** Header lines of the catch-all `/*` block. */
function catchAll(): Map<string, string> {
  const lines = file.split('\n')
  const start = lines.findIndex((l) => l.trim() === '/*')
  const out = new Map<string, string>()
  for (const l of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(l)) break
    const i = l.indexOf(':')
    out.set(l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim())
  }
  return out
}

describe('public/_headers', () => {
  const h = catchAll()
  const csp = h.get('content-security-policy') ?? ''
  const directive = (name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? ''

  it('sets a locked-down CSP', () => {
    expect(directive('default-src')).toBe("default-src 'self'")
    expect(directive('script-src')).toBe("script-src 'self'")
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive('base-uri')).toBe("base-uri 'self'")
    expect(directive('object-src')).toBe("object-src 'none'")
    expect(directive('connect-src')).toBe("connect-src 'self'")
  })

  it('allows the origins the app uses: Google Fonts, https images and audio, blob previews', () => {
    expect(directive('style-src')).toContain('https://fonts.googleapis.com')
    expect(directive('font-src')).toContain('https://fonts.gstatic.com')
    expect(directive('img-src')).toEqual(expect.stringContaining('blob:'))
    expect(directive('img-src')).toEqual(expect.stringContaining('https:'))
    expect(directive('media-src')).toEqual(expect.stringContaining('https:'))
  })

  it('never allows inline or eval script', () => {
    expect(directive('script-src')).not.toMatch(/unsafe/)
  })

  it('sets the companion headers', () => {
    expect(h.get('x-content-type-options')).toBe('nosniff')
    expect(h.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(h.get('permissions-policy')).toContain('geolocation=(self)')
    expect(h.get('permissions-policy')).toContain('camera=(self)')
  })

  it('keeps the service worker uncached', () => {
    expect(file).toMatch(/\/sw\.js\s+Cache-Control: no-cache/)
  })
})

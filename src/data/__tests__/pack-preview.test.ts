import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPackPreview } from '../pack-preview'

afterEach(() => vi.unstubAllGlobals())

describe('pack previews with shared archetype art', () => {
  it('keeps distinct sample species even when their artwork URL is shared', async () => {
    const lines = ['A alpha', 'B beta', 'C gamma'].map((sciName) => JSON.stringify({
      sciName, commonNames: { en: sciName },
      images: [{ thumbUrl: 'img/bf-archetype-general.svg', credit: 'Spidex archetype' }],
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`${lines.join('\n')}\n`)))

    const preview = await fetchPackPreview('/packs/butterfly-vn')

    expect(preview.map((species) => species.sciName)).toEqual(['A alpha', 'B beta', 'C gamma'])
    expect(new Set(preview.map((species) => species.url)).size).toBe(1)
    expect(preview.every((species) => species.archetype)).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { zSpeciesSound } from '../pack-manifest'
import { checkSpeciesNdjson } from '../../../functions/lib/submissions'

const sound = { id: 's', url: 'https://x/a.mp3', credit: 'c', license: 'CC0' }

describe('sound links are http(s) only', () => {
  it('client schema rejects javascript: and data: links', () => {
    expect(zSpeciesSound.safeParse({ ...sound, sourceUrl: 'https://xeno-canto.org/1' }).success).toBe(true)
    expect(zSpeciesSound.safeParse({ ...sound, sourceUrl: 'javascript:alert(1)' }).success).toBe(false)
    expect(zSpeciesSound.safeParse({ ...sound, licenseUrl: 'data:text/html,x' }).success).toBe(false)
  })

  it('server submission check flags the same links', () => {
    const line = (u: string) =>
      JSON.stringify({ id: 'a', sciName: 'A a', images: [{ credit: 'c', license: 'CC0' }], sounds: [{ ...sound, sourceUrl: u }] })
    expect(checkSpeciesNdjson(line('https://ok.test')).issues).toEqual([])
    expect(checkSpeciesNdjson(line('JavaScript:alert(1)')).issues[0]).toMatch(/http\(s\)/)
  })

  it('submission check refuses NoDerivatives image licences', () => {
    const line = (license: string) =>
      JSON.stringify({ id: 'a', sciName: 'A a', images: [{ credit: 'c', license }] })
    for (const nd of ['CC-BY-ND', 'CC BY-ND 4.0'.replace(/ /g, '-'), 'cc-by-nc-nd']) {
      expect(checkSpeciesNdjson(line(nd)).issues[0]).toMatch(/NoDerivatives/)
    }
    for (const ok of ['CC0', 'CC-BY', 'CC-BY-SA', 'CC-BY-NC']) {
      expect(checkSpeciesNdjson(line(ok)).issues).toEqual([])
    }
  })
})

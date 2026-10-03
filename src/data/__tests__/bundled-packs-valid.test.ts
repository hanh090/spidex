/**
 * Every pack in the shipped catalogue must pass the same validation the app
 * runs on download: one bad field (e.g. a null in a voice entry) rejects the
 * whole pack, and only installing it in a browser would otherwise show that.
 * Packs whose files are not in this checkout (media-only clones) are skipped.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { parseManifest, parseSpeciesNdjson } from '../pack-manifest'

const root = `${process.cwd()}/public/packs`
const index = JSON.parse(readFileSync(`${root}/index.json`, 'utf8')) as { packs: string[] }

describe('bundled packs validate', () => {
  for (const id of index.packs) {
    const present = existsSync(`${root}/${id}/pack.json`) && existsSync(`${root}/${id}/species.ndjson`)
    it.skipIf(!present)(`${id} manifest and species parse`, () => {
      const m = parseManifest(JSON.parse(readFileSync(`${root}/${id}/pack.json`, 'utf8')))
      expect(m.ok ? [] : m.issues).toEqual([])
      if (!m.ok) return
      const s = parseSpeciesNdjson(readFileSync(`${root}/${id}/species.ndjson`, 'utf8'), m.value.traitSchema)
      expect(s.ok ? 0 : s.issues.length, s.ok ? '' : JSON.stringify(s.issues.slice(0, 5))).toBe(0)
      // Plates are redrawn from their sources: a NoDerivatives licence forbids that.
      const nd = s.ok ? s.value.flatMap((sp) => sp.images).filter((im) => /(^|-)ND(-|$)/i.test(im.license)) : []
      expect(nd.map((im) => im.id)).toEqual([])
    })
  }
})

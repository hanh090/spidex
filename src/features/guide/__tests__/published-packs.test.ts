/**
 * The first-run hero once counted only the two featured packs while the
 * library listed every published one. Both now read fetchPublishedPacks, so
 * these pin down what that one source counts.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetchPublishedPacks } from '../published-packs'
import { CATALOGUE, FEATURED } from '../../../data/pack-catalogue'

const PACKS = join(__dirname, '..', '..', '..', '..', 'public', 'packs')
const manifest = (id: string) => readFileSync(join(PACKS, id, 'pack.json'), 'utf8')

function serve(index: object, served: string[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/packs/index.json') return new Response(JSON.stringify(index), { headers: { 'content-type': 'application/json' } })
    const id = /^\/packs\/([^/]+)\/pack\.json$/.exec(url)?.[1]
    if (id && served.includes(id)) return new Response(manifest(id), { headers: { 'content-type': 'application/json' } })
    // What the SPA fallback answers for a directory that does not exist.
    return new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })
  }))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('fetchPublishedPacks', () => {
  it('counts served previews but never markets fixtures, even if the index names one', async () => {
    serve({ version: 1, featured: ['bird-vn'], packs: ['bird-vn', 'butterfly-zz', 'butterfly-vn', 'bird-min'] }, ['bird-vn', 'butterfly-vn', 'bird-min'])
    const { index, packs } = await fetchPublishedPacks()

    expect(index.featured).toEqual(['bird-vn'])
    // An id the server cannot serve is not on offer, and keeps no slot.
    expect(packs.map((p) => p.id)).toEqual(['bird-vn', 'butterfly-vn'])
    // Catalogue numbers still follow the published order.
    expect(packs.map((p) => p.catNo)).toEqual([1, 3])
  })

  it('matches the catalogue shipped in public/packs', async () => {
    const index = JSON.parse(readFileSync(join(PACKS, 'index.json'), 'utf8')) as { packs: string[]; featured: string[] }
    const onDisk = index.packs.filter((id) => {
      try { manifest(id); return true } catch { return false }
    })
    expect([...CATALOGUE]).toEqual(index.packs)
    expect([...FEATURED]).toEqual(index.featured)
    serve(index, onDisk)
    const { packs } = await fetchPublishedPacks()
    expect(packs.length).toBe(onDisk.length)
    expect(packs.length).toBeGreaterThan(index.featured.length)
  })
})

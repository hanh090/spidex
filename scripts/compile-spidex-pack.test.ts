/**
 * The pack compiler names a pack from the region, and it once named them from
 * the bare ISO code ("Birds of TH"). These run the real compiler over every
 * checklist in the repo and require the result to match what is published, so
 * a recompile can never quietly bring a code-named pack back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const COMPILER = join(ROOT, 'scripts', 'compile_spidex_pack.py')
const CHECKLISTS = join(ROOT, 'data', 'checklists')

interface Checklist { pack_id?: string; region?: string }
interface Manifest { name: Record<string, string>; region: string }

let out: string
beforeAll(() => { out = mkdtempSync(join(tmpdir(), 'spidex-compile-')) })
afterAll(() => { rmSync(out, { recursive: true, force: true }) })

function compile(checklist: string): Manifest {
  execFileSync('python3', [COMPILER, checklist, '--out-dir', out], { stdio: 'pipe' })
  const { pack_id } = JSON.parse(readFileSync(checklist, 'utf8')) as Checklist
  return JSON.parse(readFileSync(join(out, pack_id!, 'pack.json'), 'utf8')) as Manifest
}

const compilable = readdirSync(CHECKLISTS)
  .filter((f) => f.endsWith('_checklist.json'))
  .map((f) => join(CHECKLISTS, f))
  .filter((p) => {
    const d = JSON.parse(readFileSync(p, 'utf8')) as Checklist
    return typeof d.pack_id === 'string' && typeof d.region === 'string'
  })

describe('compile_spidex_pack names packs from the region name, never the code', () => {
  it('finds the checklists it is meant to cover', () => {
    expect(compilable.length).toBeGreaterThanOrEqual(5)
  })

  it.each(compilable)('%s', (checklist) => {
    const { pack_id, region } = JSON.parse(readFileSync(checklist, 'utf8')) as Checklist
    const m = compile(checklist)

    // No name or region field may carry the bare ISO code.
    for (const value of [...Object.values(m.name), m.region]) {
      expect(value).not.toMatch(new RegExp(`\\b${region}\\b`))
    }

    // A published pack must recompile to the name it already ships with.
    const published = join(ROOT, 'public', 'packs', pack_id!, 'pack.json')
    if (existsSync(published)) {
      const live = JSON.parse(readFileSync(published, 'utf8')) as Manifest
      expect(m.name).toEqual(live.name)
      expect(m.region).toBe(live.region)
    }
  }, 60_000)

  it('refuses a region it has no name for instead of falling back to the code', () => {
    const checklist = join(out, 'unknown_checklist.json')
    writeFileSync(checklist, JSON.stringify({
      pack_id: 'bird-zz', region: 'ZZ', taxon_group: 'aves', species: [{ sciName: 'Alcedo atthis' }],
    }))
    let stderr = ''
    try {
      execFileSync('python3', [COMPILER, checklist, '--out-dir', out], { stdio: 'pipe' })
    } catch (e) {
      stderr = String((e as { stderr?: Buffer }).stderr)
    }
    expect(stderr).toMatch(/No region name for pack 'bird-zz'/)
    expect(existsSync(join(out, 'bird-zz', 'pack.json'))).toBe(false)
  })

  it('takes the name the ingest step wrote into the checklist', () => {
    const checklist = join(out, 'named_checklist.json')
    writeFileSync(checklist, JSON.stringify({
      pack_id: 'bird-zz', region: 'ZZ', region_name: { en: 'Zedland', vi: 'Xứ Zed' },
      taxon_group: 'aves', species: [{ sciName: 'Alcedo atthis' }],
    }))
    const m = compile(checklist)
    expect(m.name).toEqual({ en: 'Birds of Zedland', vi: 'Chim Xứ Zed' })
  })
})

/**
 * Pack validator for authors — the exact same contract the app enforces at
 * download time, run locally before uploading:
 *
 *   npx vite-node scripts/validate-pack.ts public/packs/bird-min
 *
 * Exits 1 with every issue listed when the pack would be rejected.
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { parseManifest, parseSpeciesNdjson } from '../src/data/pack-manifest'
import { sanitizePath } from '../functions/lib/submissions'

const dir = process.argv[2]
if (!dir || !existsSync(join(dir, 'pack.json'))) {
  console.error('usage: vite-node scripts/validate-pack.ts <pack-dir>')
  process.exit(2)
}

let manifest
try {
  const raw = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'))
  const parsed = parseManifest(raw)
  if (!parsed.ok) {
    console.error('pack.json issues:')
    for (const i of parsed.issues) console.error(`  ${i.path}: ${i.message}`)
    process.exit(1)
  }
  manifest = parsed.value
} catch (e) {
  console.error(`pack.json: ${(e as Error).message}`)
  process.exit(1)
}

let speciesText = ''
try {
  speciesText = readFileSync(join(dir, 'species.ndjson'), 'utf8')
} catch {
  console.error('species.ndjson: missing')
  process.exit(1)
}

const parsed = parseSpeciesNdjson(speciesText, manifest.traitSchema)
if (!parsed.ok) {
  console.error('species.ndjson issues:')
  for (const i of parsed.issues.slice(0, 50)) console.error(`  ${i.path}: ${i.message}`)
  if (parsed.issues.length > 50) console.error(`  …and ${parsed.issues.length - 50} more`)
  process.exit(1)
}

// Referenced files exist on disk — a broken image path is a download-time gap.
// They must also pass the uploader's path allowlist (same function the server
// enforces): a file outside it is silently dropped at upload, leaving the
// published pack with a missing image.
let missing = 0
const checkRef = (rel: string, owner?: string) => {
  const tag = owner ? ` (${owner})` : ''
  if (!existsSync(join(dir, rel))) { console.error(`  missing file: ${rel}${tag}`); missing++ }
  if (!sanitizePath(rel)) { console.error(`  not uploadable (path/type not allowed): ${rel}${tag}`); missing++ }
}
for (const sp of parsed.value) {
  for (const im of sp.images) {
    for (const rel of [im.thumbUrl, im.fullUrl].filter(Boolean) as string[]) checkRef(rel, sp.id)
  }
}
for (const trait of manifest.traitSchema.traits) {
  for (const opt of trait.options) {
    if (opt.img) checkRef(opt.img)
  }
}

if (parsed.value.length !== manifest.speciesCount) {
  console.error(`  speciesCount ${manifest.speciesCount} != ${parsed.value.length} records`)
  missing++
}

if (missing) process.exit(1)
console.log(`✓ ${manifest.id} v${manifest.version} — ${parsed.value.length} species, all files present`)

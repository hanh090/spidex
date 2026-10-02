// Uploads the pack media that git does not track (public/packs/**, ignored by
// .gitignore) to the R2 bucket under bundled/<packId>/<path>, where
// functions/packs/[[path]].ts serves it from.
//
//   CLOUDFLARE_ACCOUNT_ID=... node scripts/upload-pack-media.mjs [--bucket spidex-packs] [--jobs 12]
//
// Resumable: uploaded files are recorded (path, size, mtime) in
// .wrangler/pack-media-uploaded.json and skipped on the next run.
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'

const run = promisify(execFile)
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const bucket = arg('bucket', 'spidex-packs')
const jobs = Number(arg('jobs', '12'))
const statePath = '.wrangler/pack-media-uploaded.json'

const TYPES = {
  '.json': 'application/json', '.ndjson': 'application/x-ndjson',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
}
const typeOf = (p) => TYPES[p.slice(p.lastIndexOf('.')).toLowerCase()]

const files = execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', 'public/packs'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter((p) => p && !p.includes('.bak-') && typeOf(p))

const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {}
const stamp = (p) => {
  const s = statSync(p)
  return `${s.size}:${s.mtimeMs}`
}
const todo = files.filter((p) => state[p] !== stamp(p))
console.log(`${files.length} media files, ${todo.length} to upload to r2://${bucket}/bundled/`)

let done = 0
let failed = 0
let lastSave = Date.now()
const save = () => {
  mkdirSync('.wrangler', { recursive: true })
  writeFileSync(statePath, JSON.stringify(state))
}

async function worker() {
  for (let p = todo.shift(); p; p = todo.shift()) {
    const key = `bundled/${p.slice('public/packs/'.length)}`
    try {
      await run('npx', ['wrangler', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', p, '--content-type', typeOf(p)], {
        maxBuffer: 1 << 22,
      })
      state[p] = stamp(p)
      done++
    } catch (err) {
      failed++
      const detail = String(err.stderr || err.message).split('\n').find((l) => l.includes('ERROR')) ?? err.message
      console.error(`failed ${p}: ${detail}`)
    }
    if (Date.now() - lastSave > 5000) {
      save()
      lastSave = Date.now()
      console.log(`uploaded ${done}, failed ${failed}, left ${todo.length}`)
    }
  }
}

await Promise.all(Array.from({ length: jobs }, worker))
save()
console.log(`done: uploaded ${done}, failed ${failed}`)
process.exit(failed ? 1 : 0)

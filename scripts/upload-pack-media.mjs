// Uploads the pack media that git does not track (public/packs/**, ignored by
// .gitignore) to the R2 bucket under bundled/<packId>/<path>, where
// functions/packs/[[path]].ts serves it from.
//
//   CLOUDFLARE_ACCOUNT_ID=... node scripts/upload-pack-media.mjs [--bucket spidex-packs] [--jobs 32]
//
// Talks to the Cloudflare R2 object API directly (one wrangler process per
// file is ~50x slower). Auth: CLOUDFLARE_API_TOKEN when set, otherwise the
// token from `wrangler login`, refreshed through wrangler when it expires.
//
// Resumable: uploaded files are recorded (path, size, mtime) in
// .wrangler/pack-media-uploaded.json and skipped on the next run.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const bucket = arg('bucket', 'spidex-packs')
const jobs = Number(arg('jobs', '32'))
const account = process.env.CLOUDFLARE_ACCOUNT_ID
if (!account) throw new Error('CLOUDFLARE_ACCOUNT_ID is required')
const statePath = '.wrangler/pack-media-uploaded.json'

const TYPES = {
  '.json': 'application/json', '.ndjson': 'application/x-ndjson',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
}
const typeOf = (p) => TYPES[p.slice(p.lastIndexOf('.')).toLowerCase()]

// --- auth ---------------------------------------------------------------
const wranglerConfig = () => {
  const base = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, '.wrangler')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library/Preferences/.wrangler')
      : join(homedir(), '.config/.wrangler')
  return join(base, 'config/default.toml')
}
function readToken({ refresh = false } = {}) {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN
  // `wrangler whoami` refreshes an expired OAuth token as a side effect.
  if (refresh) execFileSync('npx', ['wrangler', 'whoami'], { stdio: 'ignore' })
  const m = readFileSync(wranglerConfig(), 'utf8').match(/^oauth_token\s*=\s*"([^"]+)"/m)
  if (!m) throw new Error('no wrangler OAuth token; run `npx wrangler login` or set CLOUDFLARE_API_TOKEN')
  return m[1]
}
let token = readToken({ refresh: true })
let refreshing = null
const refreshToken = () => (refreshing ??= Promise.resolve().then(() => {
  token = readToken({ refresh: true })
  refreshing = null
}))

async function put(key, file, type) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects/${key
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': type },
      body: readFileSync(file),
    })
    if (res.ok) return
    if (res.status === 401 || res.status === 403) await refreshToken()
    if (attempt >= 4) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
  }
}

// --- work ---------------------------------------------------------------
const files = execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', 'public/packs'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter((p) => p && !p.includes('.bak-') && typeOf(p))

let state = {}
try {
  state = JSON.parse(readFileSync(statePath, 'utf8'))
} catch {
  // Missing or torn: re-uploading a file only overwrites it with itself.
}
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
  // Write-then-rename, so a killed run never leaves a torn state file.
  writeFileSync(`${statePath}.tmp`, JSON.stringify(state))
  renameSync(`${statePath}.tmp`, statePath)
}

async function worker() {
  for (let p = todo.shift(); p; p = todo.shift()) {
    try {
      await put(`bundled/${p.slice('public/packs/'.length)}`, p, typeOf(p))
      state[p] = stamp(p)
      done++
    } catch (err) {
      failed++
      console.error(`failed ${p}: ${err.message}`)
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

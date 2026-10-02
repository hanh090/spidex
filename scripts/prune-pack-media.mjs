// Drops pack files that are not tracked in git from the build output after a
// build. Pack media lives in the R2 bucket (scripts/upload-pack-media.mjs) and
// is served by functions/packs/[[path]].ts, so a deploy from a working tree
// with local media ships exactly what a deploy from a clean checkout ships.
import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const OUT = 'dist'

const tracked = new Set(
  execFileSync('git', ['ls-files', 'public/packs'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((p) => p.slice('public/'.length)),
)

let removed = 0
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      walk(full)
      if (readdirSync(full).length === 0) rmSync(full, { recursive: true })
    } else if (!tracked.has(relative(OUT, full))) {
      rmSync(full)
      removed++
    }
  }
}

try {
  walk(join(OUT, 'packs'))
} catch (err) {
  if (err.code !== 'ENOENT') throw err
}
console.log(`prune-pack-media: removed ${removed} untracked pack files from the build output`)

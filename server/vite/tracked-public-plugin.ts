/**
 * Copies only git-tracked files from public/ into the build output.
 *
 * public/packs holds ~1 GB of pack media that git ignores: it lives in the R2
 * bucket and functions/packs/[[path]].ts serves it. Vite's own public copy
 * would duplicate all of it into the output on every build (and a deploy from
 * a working tree would differ from one from a clean checkout), so the config
 * turns that copy off and this plugin copies the tracked files instead.
 * `vite dev` still serves public/ as-is, media included.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

export function trackedPublicPlugin(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'spidex:tracked-public',
    apply: 'build',
    configResolved(resolved) {
      config = resolved
    },
    writeBundle() {
      const publicDir = config.publicDir
      const outDir = resolve(config.root, config.build.outDir)
      const files = execFileSync('git', ['ls-files', '-z', '--', publicDir], { cwd: config.root, encoding: 'utf8' })
        .split('\0')
        .filter(Boolean)
      for (const file of files) {
        const rel = resolve(config.root, file).slice(publicDir.length + 1)
        const dest = join(outDir, rel)
        mkdirSync(dirname(dest), { recursive: true })
        copyFileSync(resolve(config.root, file), dest)
      }
      config.logger.info(`tracked-public: copied ${files.length} tracked public files`)
    },
  }
}

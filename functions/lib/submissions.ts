/**
 * Community pack submissions — shared between the public
 * /api/submissions/* routes (authors) and /api/admin/* moderation.
 *
 * Storage model: a signed-in author declares a pack (`POST /api/submissions`)
 * then uploads its files one request each (`PUT .../files?path=`) — individual
 * pack files are small enough that no multipart machinery is needed. Objects
 * land at `packs/<packId>/<path>` in the PACKS bucket immediately; nothing is
 * public until an admin flips the publish flag, because both the catalogue
 * merge (packs/index.json) and the asset route (packs/[[path]]) check the D1
 * `kind='pack'` row first. Approving is a flag flip, not a copy.
 *
 * Submission bookkeeping reuses admin_resources rows with kind='submission'
 * — no extra migration.
 */

/** Slug rules match what the author tooling generates: lowercase, dashes. */
export const PACK_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

/**
 * What may be uploaded into a pack: the two data files, images, audio,
 * fonts, and nothing else — no html/js/svg can be served from a pack path,
 * which is what makes a published pack safe to serve same-origin.
 */
const ALLOWED_TOP = /^(pack\.json|species\.ndjson|img\/|audio\/|fonts\/)/

/** Image extensions serve a real image type; everything else is octet-stream. */
export const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.ndjson': 'application/x-ndjson',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}

export const MAX_FILE_BYTES = 100 * 1024 * 1024 // per-request ceiling
export const MAX_TOTAL_BYTES = 600 * 1024 * 1024 // one pack, all tiers
export const MAX_FILES = 8000
export const MAX_PENDING_PER_USER = 3

export interface SubmissionMeta {
  packId: string
  note?: string
  submitter: { userId: string; email: string }
  status: 'uploading' | 'pending' | 'published' | 'rejected' | 'withdrawn'
  fileCount: number
  totalBytes: number
  receivedFiles: number
  receivedBytes: number
  issues?: { path: string; message: string }[]
  summary?: {
    name?: { en: string }
    region?: string
    taxonGroup?: string
    version?: number
    speciesCount?: number
    sizeBytes?: { thumb: number; full: number }
  }
  reviewedBy?: string
  reviewedAt?: number
}

export function sanitizePath(raw: string): string | null {
  const p = raw.trim().replace(/^\/+/, '')
  if (!p || p.length > 220) return null
  if (p.includes('..') || p.includes('//') || p.includes('\\')) return null
  if (!/^[a-zA-Z0-9._/-]+$/.test(p)) return null
  if (!ALLOWED_TOP.test(p)) return null
  const ext = p.slice(p.lastIndexOf('.')).toLowerCase()
  if (!CONTENT_TYPES[ext]) return null
  return p
}

export function contentType(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

/**
 * Read the D1 row for a pack id. Community packs carry meta.community; the
 * published flag on the row is the single gate both the catalogue merge and
 * the asset route consult.
 */
export async function communityPackRow(
  db: any,
  packId: string,
): Promise<{ published: boolean; meta: { community?: boolean } } | null> {
  const row = await db
    .prepare("SELECT published, meta FROM admin_resources WHERE id = ? AND kind = 'pack'")
    .bind(packId)
    .first()
  if (!row) return null
  let meta: { community?: boolean } = {}
  try { meta = JSON.parse((row as any).meta) } catch { /* keep {} */ }
  return { published: !!(row as any).published, meta }
}

/**
 * Light manifest check run inside a Function — deliberately a shape check,
 * not the full zod contract: the app's download path re-validates strictly
 * before anything is committed, so a pack that lies here fails loudly for the
 * first downloader rather than silently for everyone. What this catches is
 * malformed uploads, wrong ids and missing attribution — the review signals.
 */
export function checkManifest(raw: unknown, expectedId: string): string[] {
  const issues: string[] = []
  const m = raw as any
  if (!m || typeof m !== 'object') return ['pack.json is not an object']
  if (m.id !== expectedId) issues.push(`id "${m.id}" does not match declared "${expectedId}"`)
  if (!m.name?.en || typeof m.name.en !== 'string') issues.push('name.en missing')
  if (!m.taxonGroup) issues.push('taxonGroup missing')
  if (!m.region) issues.push('region missing')
  if (!Number.isInteger(m.version) || m.version < 1) issues.push('version must be a positive integer')
  if (!m.traitSchema?.traits?.length) issues.push('traitSchema.traits missing')
  if (!m.license) issues.push('license missing')
  if (!Number.isInteger(m.speciesCount)) issues.push('speciesCount must be an integer')
  return issues
}

/** Per-record check on species.ndjson: JSON shape plus attribution presence. */
export function checkSpeciesNdjson(text: string): { issues: string[]; count: number } {
  const issues: string[] = []
  let count = 0
  text.split('\n').forEach((line, i) => {
    const t = line.trim()
    if (!t) return
    count++
    try {
      const sp = JSON.parse(t)
      if (!sp.id || !sp.sciName) issues.push(`line ${i + 1}: id/sciName missing`)
      if (!Array.isArray(sp.images) || !sp.images.length) {
        issues.push(`line ${i + 1}: no images`)
      } else if (sp.images.some((im: any) => !im.credit || !im.license)) {
        issues.push(`line ${i + 1}: image without credit/license`)
      }
    } catch {
      issues.push(`line ${i + 1}: not valid JSON`)
    }
  })
  return { issues: issues.slice(0, 50), count }
}

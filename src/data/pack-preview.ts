/**
 * A few real plates from a pack, for screens that show a pack before it is
 * installed.
 *
 * Reads small ranges of `species.ndjson` rather than pulling a 1.8MB catalogue
 * to show three thumbnails. A server that ignores Range returns the whole file,
 * which still works: the parse stops at the last complete line either way.
 *
 * Two things this deliberately does NOT do naively:
 *
 *   - It skips archetype fallbacks. Butterflies of Vietnam carries 60 real
 *     plates against 1,429 species; everything else points at a shared
 *     `*-archetype-*` drawing. A preview built from those advertises the pack
 *     with three copies of one generic silhouette.
 *   - It does not always read from the top. The head of the file is the
 *     alphabetical start of the checklist, which for that pack is entirely
 *     archetypes — so the pack that most needed a good preview got the worst
 *     possible one. When the head yields too few real plates, it samples
 *     further in.
 *
 * Preview art is decorative. Every failure path returns whatever it has, and
 * no caller may depend on it — a pack with no reachable preview must still be
 * fully installable.
 */

export interface PackPreview {
  /** Absolute URL, ready for src. */
  url: string
  sciName: string
  /** Provenance of the plate — a photograph credit, or a drawing statement. */
  credit: string
  /** True when this is a shared fallback drawing rather than a real plate. */
  archetype: boolean
}

/** ~10 species records per read. Enough to matter, small enough to be free. */
const CHUNK = 12_000
/** Where to sample when the head of the file is all fallbacks. */
const SAMPLE_FRACTIONS = [0.45, 0.8]

interface Chunk { text: string; totalBytes: number }

async function readChunk(url: string, start: number, signal?: AbortSignal): Promise<Chunk | null> {
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=${start}-${start + CHUNK - 1}` },
      signal,
    })
    // 206 is the Range hit; 200 means the server sent everything instead.
    if (!res.ok && res.status !== 206) return null
    // "bytes 0-11999/1855372" — learning the total size costs nothing extra.
    const total = Number(res.headers.get('Content-Range')?.split('/')[1]) || 0
    return { text: await res.text(), totalBytes: total }
  } catch {
    return null
  }
}

function parse(text: string, baseUrl: string, dropFirstLine: boolean): PackPreview[] {
  const lines = text.split('\n')
  // A mid-file read starts inside a record, and the tail is cut either way.
  if (dropFirstLine) lines.shift()
  lines.pop()

  const out: PackPreview[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const rec = JSON.parse(line) as {
        sciName?: string
        images?: { thumbUrl?: string; credit?: string }[]
      }
      const img = rec.images?.[0]
      if (!img?.thumbUrl) continue
      out.push({
        url: `${baseUrl}/${img.thumbUrl}`,
        sciName: rec.sciName ?? '',
        credit: img.credit ?? '',
        archetype: /archetype/i.test(img.thumbUrl),
      })
    } catch {
      /* Partial or malformed line — skip it, keep the rest. */
    }
  }
  return out
}

export async function fetchPackPreview(
  baseUrl: string,
  count = 3,
  signal?: AbortSignal,
): Promise<PackPreview[]> {
  const url = `${baseUrl}/species.ndjson`

  const head = await readChunk(url, 0, signal)
  if (!head) return []

  const seen = new Set<string>()
  const real: PackPreview[] = []
  const fallback: PackPreview[] = []

  const collect = (items: PackPreview[]) => {
    for (const item of items) {
      if (seen.has(item.url)) continue
      seen.add(item.url)
      ;(item.archetype ? fallback : real).push(item)
    }
  }

  collect(parse(head.text, baseUrl, false))

  // Only pay for more reads when the head could not supply real plates. A pack
  // with real artwork throughout — Birds of Vietnam is 962 of 962 — costs one
  // request and never reaches this.
  if (real.length < count && head.totalBytes > CHUNK) {
    for (const fraction of SAMPLE_FRACTIONS) {
      if (real.length >= count) break
      const chunk = await readChunk(url, Math.floor(head.totalBytes * fraction), signal)
      if (chunk) collect(parse(chunk.text, baseUrl, true))
    }
  }

  // Real plates first, fallbacks after, so a pack is never blank.
  return [...real, ...fallback].slice(0, count)
}

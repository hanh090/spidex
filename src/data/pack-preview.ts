/**
 * A few real plates from a pack, for screens that show a pack before it is
 * installed.
 *
 * Reads only the first few kilobytes of `species.ndjson` with a Range request
 * rather than pulling a 1.2MB catalogue to show three thumbnails. A server
 * that ignores Range returns the whole file, which still works: the parse
 * stops at the last complete line either way.
 *
 * Preview art is decorative. Every failure path returns an empty list, and no
 * caller may depend on it — a pack with no reachable preview must still be
 * fully installable.
 */

export interface PackPreview {
  /** Absolute URL, ready for src. */
  url: string
  sciName: string
  /** Provenance of the plate — a photograph credit, or a drawing statement. */
  credit: string
}

/** ~10 species records. Enough for a preview strip, small enough to be free. */
const PREVIEW_BYTES = 12_000

export async function fetchPackPreview(
  baseUrl: string,
  count = 3,
  signal?: AbortSignal,
): Promise<PackPreview[]> {
  try {
    const res = await fetch(`${baseUrl}/species.ndjson`, {
      headers: { Range: `bytes=0-${PREVIEW_BYTES - 1}` },
      signal,
    })
    // 206 is the Range hit; 200 means the server sent everything instead.
    if (!res.ok && res.status !== 206) return []

    const lines = (await res.text()).split('\n')
    // The last line is very likely cut mid-record. Never hand it to JSON.parse.
    lines.pop()

    const out: PackPreview[] = []
    for (const line of lines) {
      if (out.length >= count) break
      if (!line.trim()) continue
      try {
        const rec = JSON.parse(line) as {
          sciName?: string
          images?: { thumbUrl?: string; credit?: string }[]
        }
        const img = rec.images?.[0]
        if (img?.thumbUrl) {
          out.push({
            url: `${baseUrl}/${img.thumbUrl}`,
            sciName: rec.sciName ?? '',
            credit: img.credit ?? '',
          })
        }
      } catch {
        /* Partial or malformed line — skip it, keep the rest. */
      }
    }
    return out
  } catch {
    return []
  }
}

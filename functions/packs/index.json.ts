/**
 * Serves the public pack catalogue at /packs/index.json, filtered by the
 * admin store's publish flags.
 *
 * The static file is the source of truth (fetched via next()); D1 rows of
 * kind='pack' with published=0 remove ids from it, and published community
 * rows join it — but only when the PACKS bucket that serves them is bound.
 * With no DB bound, or when the file is absent, the asset response passes
 * through untouched — the catalogue works on a zero-config deploy. Any D1
 * failure degrades to the unmodified static catalogue, never a 500.
 */
import { mergeCatalogue, type CatalogueRow } from '../lib/submissions'

export const onRequestGet = async (context: any) => {
  const res: Response = await context.next()
  const db = context.env?.DB
  if (!res.ok || !db) return res

  // The body can be read only once; keep an untouched copy for the fallback.
  const fallback = res.clone()
  try {
    const index = JSON.parse(await res.text())
    const { results } = await db
      .prepare("SELECT id, published, meta FROM admin_resources WHERE kind = 'pack'")
      .all()

    const rows: CatalogueRow[] = (results as { id: string; published: number; meta: string }[]).map((r) => {
      let community = false
      try { community = !!JSON.parse(r.meta)?.community } catch { /* malformed meta: don't publish it */ }
      return { id: r.id, published: !!r.published, community }
    })

    return new Response(JSON.stringify(mergeCatalogue(index, rows, !!context.env.PACKS)), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('catalogue merge failed; serving static index', err)
    return fallback
  }
}

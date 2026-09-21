/**
 * Serves the public pack catalogue at /packs/index.json, filtered by the
 * admin store's publish flags.
 *
 * The static file is the source of truth (fetched via next()); D1 rows of
 * kind='pack' with published=0 remove ids from it. With no DB bound, or when
 * the file is absent, the asset response passes through untouched — the
 * catalogue works on a zero-config deploy.
 */
export const onRequestGet = async (context: any) => {
  const res = await context.next()
  const db = context.env?.DB
  if (!res.ok || !db) return res

  try {
    const text = await res.text()
    const index = JSON.parse(text)
    const { results } = await db
      .prepare("SELECT id FROM admin_resources WHERE kind = 'pack' AND published = 0")
      .all()
    const hidden = new Set((results as { id: string }[]).map((r) => r.id))
    if (!hidden.size) {
      return new Response(text, { status: res.status, headers: res.headers })
    }
    index.packs = (index.packs ?? []).filter((id: string) => !hidden.has(id))
    index.featured = (index.featured ?? []).filter((id: string) => !hidden.has(id))
    return new Response(JSON.stringify(index), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch {
    return res
  }
}

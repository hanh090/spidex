/**
 * The globally-scoped pack, for the header and the drawer.
 *
 * Scope is global and shown everywhere, so the header must state the real pack
 * — an indicator hardcoded to "no pack" is worse than none, because it
 * contradicts the app's own state.
 */
import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { db, getActivePackId } from '../../data/db'
import { resolve } from '../../data/localized'
import i18n from '../../i18n'

export function useActivePackName(): { name: string | null; loading: boolean } {
  const [name, setName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const query = liveQuery(async () => {
      const id = await getActivePackId()
      const pack = id ? await db.packs.get(id) : undefined
      return pack?.manifest.name ?? null
    })
    let nameByLanguage: Parameters<typeof resolve>[0] | null = null
    const translate = () => {
      if (!cancelled) setName(nameByLanguage ? resolve(nameByLanguage) : null)
    }
    const subscription = query.subscribe({
      next: (value) => {
        nameByLanguage = value
        translate()
        if (!cancelled) setLoading(false)
      },
      error: () => { if (!cancelled) setLoading(false) },
    })
    i18n.on('languageChanged', translate)
    return () => { cancelled = true; subscription.unsubscribe(); i18n.off('languageChanged', translate) }
  }, [])

  return { name, loading }
}

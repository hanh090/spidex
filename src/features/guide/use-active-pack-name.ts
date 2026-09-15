/**
 * The globally-scoped pack, for the header and the drawer.
 *
 * Scope is global and shown everywhere, so the header must state the real pack
 * — an indicator hardcoded to "no pack" is worse than none, because it
 * contradicts the app's own state.
 */
import { useEffect, useState } from 'react'
import { db, getActivePackId } from '../../data/db'
import { resolve } from '../../data/localized'
import i18n from '../../i18n'

export function useActivePackName(): { name: string | null; loading: boolean } {
  const [name, setName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const read = async () => {
      const id = await getActivePackId()
      const pack = id ? await db.packs.get(id) : undefined
      if (cancelled) return
      setName(pack ? resolve(pack.manifest.name) : null)
      setLoading(false)
    }
    void read()
    // Re-resolve on language change so the pack name follows the UI language.
    i18n.on('languageChanged', read)
    return () => { cancelled = true; i18n.off('languageChanged', read) }
  }, [])

  return { name, loading }
}

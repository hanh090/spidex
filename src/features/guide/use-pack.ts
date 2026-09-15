/**
 * Live access to the active pack and its species, from the local store.
 * Everything here works with no network by construction.
 */
import { useEffect, useState } from 'react'
import { db, getActivePackId, setActivePackId, speciesUid, type StoredPack, type StoredSpecies } from '../../data/db'

export interface ActivePack {
  pack: StoredPack | null
  species: StoredSpecies[]
  baseUrl: string
  loading: boolean
}

export function packBaseUrl(packId: string): string {
  return `/packs/${packId}`
}

export function useActivePack(): ActivePack {
  const [state, setState] = useState<ActivePack>({ pack: null, species: [], baseUrl: '', loading: true })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let id = await getActivePackId()
      if (!id) {
        const firstPack = await db.packs.toCollection().first()
        if (firstPack) {
          id = firstPack.id
          await setActivePackId(id)
        }
      }
      if (!id) { if (!cancelled) setState({ pack: null, species: [], baseUrl: '', loading: false }); return }
      const [pack, species] = await Promise.all([
        db.packs.get(id),
        db.species.where('packId').equals(id).toArray(),
      ])
      if (cancelled) return
      setState({
        pack: pack ?? null,
        species: species.sort((a, b) => a.sciName.localeCompare(b.sciName)),
        baseUrl: packBaseUrl(id),
        loading: false,
      })
    })()
    return () => { cancelled = true }
  }, [])

  return state
}

/**
 * Load one species by its pack-scoped uid, plus only the handful of species
 * its `similarTo` names. Species detail must not pull the whole table.
 */
export function useSpecies(uid: string | undefined) {
  const [sp, setSp] = useState<StoredSpecies | null>(null)
  const [similar, setSimilar] = useState<StoredSpecies[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!uid) { setSp(null); setSimilar([]); setLoading(false); return }
    void (async () => {
      const row = await db.species.get(uid)
      if (cancelled) return
      setSp(row ?? null)
      if (row?.similarTo.length) {
        const keys = row.similarTo.map((id) => speciesUid(row.packId, id))
        const rows = (await db.species.bulkGet(keys)).filter(Boolean) as StoredSpecies[]
        if (!cancelled) setSimilar(rows)
      } else if (!cancelled) {
        setSimilar([])
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [uid])

  return { species: sp, similar, loading }
}

/**
 * Thin typed wrappers over /api/sync/*. No retry or state logic lives here —
 * the engine decides what a failure means. A rejected fetch (no network)
 * propagates as-is; an HTTP error status becomes a SyncHttpError.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class SyncHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'SyncHttpError'
  }
}

export interface PushRecord {
  id: string
  clientVersion: number
  payload: Record<string, unknown>
}

export interface PushResult {
  id: string
  result: 'applied' | 'stale' | 'rejected'
  serverSeq?: number
  clientVersion?: number
  reason?: string
  server?: { payload: Record<string, unknown> | null; deletedAt: number | null }
}

export interface PulledRecord {
  id: string
  clientVersion: number
  serverSeq: number
  deletedAt: number | null
  payload: Record<string, unknown> | null
}

export interface PullPage {
  sightings: PulledRecord[]
  cursor: number
  hasMore: boolean
}

export interface PulledPhotoMeta {
  id: string
  sightingId: string
  width: number
  height: number
  bytes: number
  createdAt: number
  serverSeq: number
  deletedAt: number | null
}

export interface PhotoPullPage {
  photos: PulledPhotoMeta[]
  cursor: number
  hasMore: boolean
}

export interface PhotoUpload {
  id: string
  sightingId: string
  blob: Blob
  width: number
  height: number
}

async function check(res: Response): Promise<Response> {
  if (res.ok) return res
  let message = `HTTP ${res.status}`
  try {
    const data = await res.json()
    if (typeof data?.error === 'string') message = data.error
  } catch { /* non-JSON error body */ }
  throw new SyncHttpError(res.status, message)
}

export function createSyncApi(fetchFn: FetchLike = (input, init) => fetch(input, init)) {
  const jsonInit = (method: string, body?: unknown): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  return {
    async pushSightings(records: PushRecord[]): Promise<PushResult[]> {
      const res = await check(await fetchFn('/api/sync/sightings', jsonInit('POST', { records })))
      return ((await res.json()) as { results: PushResult[] }).results
    },

    async pullSightings(since: number): Promise<PullPage> {
      const res = await check(await fetchFn(`/api/sync/sightings?since=${since}`, { headers: { Accept: 'application/json' } }))
      return (await res.json()) as PullPage
    },

    async deleteSighting(id: string): Promise<void> {
      await ignoreNotFound(await fetchFn(`/api/sync/sightings/${encodeURIComponent(id)}`, { method: 'DELETE' }))
    },

    async uploadPhoto(p: PhotoUpload): Promise<'uploaded' | 'needs_credits'> {
      const q = new URLSearchParams({
        photoId: p.id, sightingId: p.sightingId, width: String(p.width), height: String(p.height),
      })
      const res = await fetchFn(`/api/sync/photos?${q}`, {
        method: 'POST',
        headers: { 'Content-Type': p.blob.type || 'image/jpeg' },
        body: p.blob,
      })
      if (res.status === 402) return 'needs_credits'
      await check(res)
      return 'uploaded'
    },

    async pullPhotos(since: number): Promise<PhotoPullPage> {
      const res = await check(await fetchFn(`/api/sync/photos?since=${since}`, { headers: { Accept: 'application/json' } }))
      return (await res.json()) as PhotoPullPage
    },

    /** The owner's stored image, or null when it is gone (deleted or never stored). */
    async downloadPhoto(id: string): Promise<Blob | null> {
      const res = await fetchFn(`/api/sync/photos/${encodeURIComponent(id)}`)
      if (res.status === 404) return null
      await check(res)
      const type = res.headers.get('Content-Type') ?? ''
      if (!type.startsWith('image/')) return null
      return res.blob()
    },

    async deletePhoto(id: string): Promise<void> {
      await ignoreNotFound(await fetchFn(`/api/sync/photos/${encodeURIComponent(id)}`, { method: 'DELETE' }))
    },
  }
}

/** A tombstone for something the server never had is already "done". */
async function ignoreNotFound(res: Response): Promise<void> {
  if (res.status === 404) return
  await check(res)
}

export type SyncApi = ReturnType<typeof createSyncApi>

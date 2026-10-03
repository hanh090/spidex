/**
 * Client for /api/admin/*. Every call fails soft — the admin console renders
 * the error rather than throwing through a screen the user navigated into.
 */

export interface AdminStatus {
  user: { userId: string; email: string; firstName?: string | null } | null
  isAdmin: boolean
  /** The D1 resource store is bound. Reads work without it; writes 503. */
  store: boolean
}

export interface AdminPack {
  id: string
  name?: { en: string; vi?: string; de?: string }
  region?: string
  taxonGroup?: string
  version?: number
  speciesCount?: number
  sizeBytes?: { thumb: number; full: number }
  featured?: boolean
  published?: boolean
  /** Author-uploaded pack served from R2, not the deploy bundle. */
  community?: boolean
  /** Listed in the index but its manifest could not be read. */
  missing?: boolean
}

export interface AdminOverview {
  packs: AdminPack[]
  catalogueError: string | null
  store: boolean
  generatedAt: number
}

export interface AdminResource {
  id: string
  kind: string
  title: string
  meta: Record<string, unknown>
  published: boolean
  sort: number
  updatedAt: number
}

export interface AdminUser {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  emailVerified?: boolean
  createdAt?: string
}

/** An API failure that keeps the HTTP status, so a screen can tell a conflict from an outage. */
export class AdminApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { Accept: 'application/json', ...(init?.method ? { 'Content-Type': 'application/json' } : {}) },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new AdminApiError((data as any).error || `HTTP ${res.status}`, res.status)
  return data as T
}

export function fetchAdminStatus(): Promise<AdminStatus> {
  return call<AdminStatus>('/api/admin/me').catch(() => ({ user: null, isAdmin: false, store: false }))
}

export function fetchAdminOverview(): Promise<AdminOverview> {
  return call<AdminOverview>('/api/admin/overview')
}

export function fetchAdminResources(kind?: string): Promise<{ resources: AdminResource[] }> {
  return call(`/api/admin/resources${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`)
}

export function createAdminResource(body: {
  id?: string
  kind: string
  title: string
  meta?: Record<string, unknown>
  published?: boolean
  sort?: number
}): Promise<{ ok: true; id: string }> {
  return call('/api/admin/resources', { method: 'POST', body: JSON.stringify(body) })
}

export function updateAdminResource(
  id: string,
  patch: Partial<Pick<AdminResource, 'title' | 'meta' | 'published' | 'sort'>>,
): Promise<{ ok: true }> {
  return call(`/api/admin/resources/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function deleteAdminResource(id: string): Promise<{ ok: true }> {
  return call(`/api/admin/resources/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function setPackPublished(packId: string, published: boolean): Promise<{ ok: true; published: boolean }> {
  return call(`/api/admin/packs/${encodeURIComponent(packId)}/publish`, {
    method: 'POST',
    body: JSON.stringify({ published }),
  })
}

export function fetchAdminUsers(): Promise<{ users: AdminUser[]; error?: string }> {
  return call('/api/admin/users')
}

export interface AdminSubmission extends AdminResource {
  meta: Record<string, unknown> & {
    packId?: string
    status?: string
    note?: string
    submitter?: { userId: string; email: string }
    issues?: { path: string; message: string }[]
    receivedFiles?: number
    fileCount?: number
    summary?: { name?: { en?: string }; speciesCount?: number }
  }
}

export function fetchAdminSubmissions(): Promise<{ submissions: AdminSubmission[] }> {
  return call('/api/admin/submissions')
}

export function reviewSubmission(id: string, action: 'approve' | 'reject'): Promise<{ ok: true; packId?: string }> {
  return call(`/api/admin/submissions/${encodeURIComponent(id)}/${action}`, { method: 'POST' })
}

/* ---- media ----------------------------------------------------------------- */

export interface MediaFlags { nc: boolean; nd: boolean; archetype: boolean }

export interface MediaPack {
  id: string
  community: boolean
  missing?: boolean
  name?: { en: string; vi?: string; de?: string }
  version?: number
  speciesCount?: number
  licenses?: Record<string, number>
  counts?: { images: number; nc: number; nd: number; archetype: number }
}

export interface MediaImage {
  id: string
  aspect: string
  credit: string
  license: string
  thumbUrl: string
  fullUrl?: string
  /** Server-computed on read; ignored on write. */
  flags?: MediaFlags
}

export interface MediaSpecies {
  id: string
  sciName: string
  name: string
  family: string
  flags: MediaFlags
  images: MediaImage[]
}

export type MediaFilter = 'all' | 'nc' | 'nd' | 'archetype'

export interface MediaSpeciesPage {
  species: MediaSpecies[]
  total: number
  nextCursor: string | null
  /** Pack version this page reflects; send it back as `baseVersion` when saving. */
  version: number
  aspects: { required: string[]; optional: string[] }
}

export function fetchMediaPacks(): Promise<{ packs: MediaPack[] }> {
  return call('/api/admin/media/packs')
}

export function fetchMediaSpecies(
  packId: string,
  opts: { q?: string; filter?: MediaFilter; cursor?: string | null } = {},
): Promise<MediaSpeciesPage> {
  const qs = new URLSearchParams()
  if (opts.q) qs.set('q', opts.q)
  if (opts.filter && opts.filter !== 'all') qs.set('filter', opts.filter)
  if (opts.cursor) qs.set('cursor', opts.cursor)
  return call(`/api/admin/media/packs/${encodeURIComponent(packId)}/species?${qs}`)
}

export function saveMediaImages(
  packId: string,
  speciesId: string,
  images: MediaImage[],
  baseVersion: number,
): Promise<{ ok: true; version: number; images: MediaImage[] }> {
  // `flags` is read-only decoration from the server.
  const clean = images.map((im) => {
    const { flags, ...rest } = im
    void flags
    return rest
  })
  return call(`/api/admin/media/packs/${encodeURIComponent(packId)}/species/${encodeURIComponent(speciesId)}/images`, {
    method: 'PUT',
    body: JSON.stringify({ images: clean, baseVersion }),
  })
}

/** Upload a raster image into the pack; resolves to its pack-relative url (img/<file>). */
export async function uploadMediaImage(packId: string, file: File, path: string): Promise<{ ok: true; url: string }> {
  const res = await fetch(`/api/admin/media/packs/${encodeURIComponent(packId)}/upload?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new AdminApiError((data as any).error || `HTTP ${res.status}`, res.status)
  return data as { ok: true; url: string }
}

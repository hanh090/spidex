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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { Accept: 'application/json', ...(init?.method ? { 'Content-Type': 'application/json' } : {}) },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any).error || `HTTP ${res.status}`)
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

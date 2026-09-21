/**
 * The complete local schema for the whole app.
 *
 * Every table the app will ever need is declared here, in this phase, so no
 * later phase bumps the schema version — two phases editing this file
 * concurrently produce an `onupgradeneeded` that never runs and tables that do
 * not exist at runtime on already-installed clients.
 *
 * Local is the source of truth. Sync (Phase 6) is an enhancement layered on
 * top; nothing here depends on a server existing.
 */
import Dexie, { type EntityTable } from 'dexie'
import type { PackManifest, SpeciesRecord, Sensitivity } from './pack-manifest'

/** A downloaded pack, with which image tier is actually on the device. */
export interface StoredPack {
  id: string
  manifest: PackManifest
  version: number
  tier: 'thumb' | 'full'
  installedAt: number
  /** Bytes actually written, for the pack manager readout. */
  bytes: number
}

export interface StoredSpecies extends SpeciesRecord {
  /**
   * Primary key: `${packId}:${id}`.
   *
   * The authored `id` is only unique WITHIN a pack — regional packs of the
   * same taxon group routinely share species ids. Keying on the bare id would
   * let pack B overwrite pack A's rows, and then deleting B would strip
   * species A still needs.
   */
  uid: string
  packId: string
  packVersion: number
  /** Denormalized for the search index; not authored. */
  searchBlob: string
}

export const speciesUid = (packId: string, speciesId: string): string => `${packId}:${speciesId}`

export interface Favourite {
  id: string        // `${packId}:${speciesId}`
  packId: string
  speciesId: string
  addedAt: number
}

export type SyncState = 'local' | 'queued' | 'uploading' | 'synced' | 'failed' | 'conflict' | 'needs_credits'
export type ClockConfidence = 'trusted' | 'suspect'

export interface Sighting {
  /** Client-generated at creation. Record identity, sync idempotency key,
   *  and ledger reference. Never regenerated. */
  id: string
  /** Owns the record before any account exists. */
  installId: string
  userId?: string

  speciesId?: string        // undefined ⇒ Needs ID (the authored, pack-scoped id)
  /** Pack binding: a taxonomic split must not orphan the log. */
  packId?: string
  packVersion?: number
  /**
   * Survives the species disappearing from a later pack version, or its pack
   * being removed entirely.
   *
   * `sensitivity` is snapshotted deliberately: export must never have to look
   * the species up to decide whether to generalize coordinates, because that
   * lookup fails open to full precision exactly when the pack is gone.
   */
  speciesSnapshot?: { sciName: string; commonName: string; sensitivity: Sensitivity }

  count: number
  /** UTC ms. The device clock is not trusted — see tzOffsetMinutes/clockConfidence. */
  at: number
  tzOffsetMinutes: number
  clockConfidence: ClockConfidence

  lat?: number
  lng?: number
  accuracy?: number

  notes: string
  tripId?: string

  syncState: SyncState
  /** Monotonic per record, incremented locally on every edit. Ordering key
   *  for Phase 6 conflict resolution — skew-immune without a CRDT. */
  clientVersion: number
  updatedAt: number
}

/**
 * Photos are their own rows, not an array on the sighting: record-level
 * last-write-wins over an array field is deletion of user media.
 */
export interface Photo {
  /** Generated at capture. R2 object key, upload-confirm key, and the
   *  photo-sync ledger idempotency key are all this value. */
  id: string
  sightingId: string
  /** The untouched capture. Users are wildlife photographers. */
  original: Blob
  /** Downscaled derivative used for display and, later, for sync. */
  derived: Blob
  width: number
  height: number
  takenAt: number
  syncState: SyncState
  deletedAt?: number
}

export interface Trip {
  id: string
  name: string
  startedAt: number
  endedAt?: number
  locationLabel: string
}

export interface QueueItem {
  id: string
  kind: 'sighting' | 'photo'
  refId: string
  attempts: number
  lastError?: string
  queuedAt: number
}

export interface LedgerCacheRow {
  id: string
  balance: number
  updatedAt: number
}

export interface AppMeta {
  key: string
  value: unknown
}

export class SpidexDb extends Dexie {
  packs!: EntityTable<StoredPack, 'id'>
  species!: EntityTable<StoredSpecies, 'uid'>
  favourites!: EntityTable<Favourite, 'id'>
  sightings!: EntityTable<Sighting, 'id'>
  photos!: EntityTable<Photo, 'id'>
  trips!: EntityTable<Trip, 'id'>
  syncQueue!: EntityTable<QueueItem, 'id'>
  ledgerCache!: EntityTable<LedgerCacheRow, 'id'>
  meta!: EntityTable<AppMeta, 'key'>

  constructor() {
    super('spidex')
    this.version(1).stores({
      packs: 'id, version',
      // Compound index on [packId+family] backs the family filter; searchBlob
      // is scanned in memory by the search index, not indexed here.
      species: 'uid, id, packId, [packId+family], sciName',
      favourites: 'id, packId, speciesId, addedAt',
      // packId is indexed: pack delete and pack update both query by it, and
      // Dexie throws SchemaError on where() over an unindexed keyPath.
      sightings: 'id, installId, userId, speciesId, packId, tripId, at, syncState, updatedAt',
      photos: 'id, sightingId, syncState',
      trips: 'id, startedAt',
      syncQueue: 'id, kind, refId, queuedAt',
      ledgerCache: 'id',
      meta: 'key',
    })
  }
}

export const db = new SpidexDb()

/* ---- meta helpers ------------------------------------------------------- */

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return row ? (row.value as T) : fallback
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

/** Stable per-install id. Owns local records until an account claims them. */
export async function getInstallId(): Promise<string> {
  const existing = await getMeta<string | null>('installId', null)
  if (existing) return existing
  const id = crypto.randomUUID()
  await setMeta('installId', id)
  return id
}

/** Which pack the guide is currently scoped to. Scope is global. */
export async function getActivePackId(): Promise<string | null> {
  return getMeta<string | null>('activePackId', null)
}

export async function setActivePackId(id: string | null): Promise<void> {
  await setMeta('activePackId', id)
}

export type { Sensitivity }

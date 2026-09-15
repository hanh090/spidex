/**
 * Photo capture and storage.
 *
 * The original is kept untouched — users are wildlife photographers and a
 * discarded original of a rare species is unrecoverable. A downscaled
 * derivative is what the app displays and, later, syncs.
 *
 * Every photo gets a UUID at capture. That id is the R2 object key, the
 * upload-confirm key, and the photo-sync ledger idempotency key: a
 * server-minted id would make every retry a fresh key and a double charge.
 */
import { db, type Photo } from '../../data/db'

const DERIVED_LONG_EDGE = 2048
const DERIVED_QUALITY = 0.85

export interface CapturedPhoto {
  id: string
  original: Blob
  derived: Blob
  width: number
  height: number
  takenAt: number
  previewUrl: string
}

async function downscale(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, DERIVED_LONG_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', DERIVED_QUALITY))
  return { blob: blob ?? file, width: w, height: h }
}

/** Prepare a captured file. Nothing is written until the sighting is saved. */
export async function prepare(file: File): Promise<CapturedPhoto> {
  const id = crypto.randomUUID()
  let derived = file as Blob
  let width = 0
  let height = 0
  try {
    const d = await downscale(file)
    derived = d.blob
    width = d.width
    height = d.height
  } catch {
    // No bitmap decoder (or an unsupported format): keep the original as the
    // derivative rather than losing the photo.
  }
  return { id, original: file, derived, width, height, takenAt: Date.now(), previewUrl: URL.createObjectURL(derived) }
}

export function toRow(p: CapturedPhoto, sightingId: string): Photo {
  return {
    id: p.id,
    sightingId,
    original: p.original,
    derived: p.derived,
    width: p.width,
    height: p.height,
    takenAt: p.takenAt,
    syncState: 'local',
  }
}

/** Release a prepared photo's preview URL. Callers must do this on unmount. */
export function releasePreview(p: CapturedPhoto): void {
  URL.revokeObjectURL(p.previewUrl)
}

export async function photosFor(sightingId: string): Promise<Photo[]> {
  return db.photos.where('sightingId').equals(sightingId).filter((p) => !p.deletedAt).toArray()
}

/** Tombstone rather than delete, so Phase 6 can union-merge across devices. */
export async function softDelete(photoId: string): Promise<void> {
  await db.photos.update(photoId, { deletedAt: Date.now(), syncState: 'local' })
}

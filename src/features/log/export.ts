/**
 * Export — a purely local file write. No server, no account, no network, and
 * never metered: the contract is explicit that a user is not charged to read
 * their own records, and there is no request here to meter even if it were.
 *
 * Coordinates for sensitive species are GENERALIZED BY DEFAULT.
 *
 * Exported files get posted to forums and group chats — that is the normal,
 * encouraged behaviour for a life-list app, and it is exactly how locality
 * data for threatened species leaks. GBIF publishes categories for this:
 *   1 — publish nothing
 *   2 — generalize (10 km grid here)
 *   3 — full precision only to licensed clients (treated as 2)
 * Full precision requires an explicit, warned opt-in.
 */
import type { Sighting } from '../../data/db'
import type { Sensitivity } from '../../data/pack-manifest'

export interface ExportOptions {
  /** Opt in to full precision for sensitive species. Requires a warned confirm. */
  fullPrecision?: boolean
}

/** Round to a ~10 km grid (0.1 degree). Category 1 yields no coordinates at all. */
export function generalize(
  lat: number | undefined,
  lng: number | undefined,
  sensitivity: Sensitivity,
  fullPrecision: boolean,
): { lat?: number; lng?: number; generalized: boolean } {
  if (lat == null || lng == null) return { generalized: false }
  if (fullPrecision || sensitivity === 0) return { lat, lng, generalized: false }
  if (sensitivity === 1) return { generalized: true } // withheld entirely
  const round = (v: number) => Math.round(v * 10) / 10
  return { lat: round(lat), lng: round(lng), generalized: true }
}

/**
 * Sensitivity comes from the sighting's own snapshot, never from a lookup.
 *
 * A lookup fails open exactly when it matters most: `deletePack` keeps
 * sightings but removes species rows, so a nesting-raptor record whose pack
 * was deleted to free space would export at full precision. When a snapshot
 * is somehow absent, default to 2 (generalize) rather than 0 — the safe
 * direction is to under-share.
 */
function sensitivityFor(s: Sighting): Sensitivity {
  if (!s.speciesId) return 0            // an unidentified record names no taxon
  return s.speciesSnapshot?.sensitivity ?? 2
}

interface ExportRow {
  id: string
  sciName: string
  commonName: string
  count: number
  isoTime: string
  lat?: number
  lng?: number
  accuracy?: number
  generalized: boolean
  clockConfidence: string
  notes: string
}

function rows(sightings: Sighting[], opts: ExportOptions): ExportRow[] {
  const out: ExportRow[] = []
  for (const s of sightings) {
    const sens = sensitivityFor(s)
    const g = generalize(s.lat, s.lng, sens, opts.fullPrecision ?? false)
    out.push({
      id: s.id,
      sciName: s.speciesSnapshot?.sciName ?? '',
      commonName: s.speciesSnapshot?.commonName ?? '',
      count: s.count,
      isoTime: new Date(s.at).toISOString(),
      lat: g.lat,
      lng: g.lng,
      // Accuracy is withheld with a generalized position: a tight accuracy on
      // a rounded coordinate would imply precision that is not there.
      accuracy: g.generalized ? undefined : s.accuracy,
      generalized: g.generalized,
      clockConfidence: s.clockConfidence,
      notes: s.notes,
    })
  }
  return out
}

const csvCell = (v: unknown): string => {
  let s = v == null ? '' : String(v)
  // Formula injection: these files are meant to be shared, and a note opening
  // with = + - @ executes when the CSV is opened in Excel or Sheets.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(sightings: Sighting[], opts: ExportOptions = {}): string {
  const data = rows(sightings, opts)
  const head = [
    'id', 'scientificName', 'commonName', 'individualCount', 'eventDate',
    'decimalLatitude', 'decimalLongitude', 'coordinateUncertaintyInMeters',
    'coordinatesGeneralized', 'clockConfidence', 'occurrenceRemarks',
  ]
  const lines = [head.join(',')]
  for (const r of data) {
    lines.push([
      r.id, r.sciName, r.commonName, r.count, r.isoTime,
      r.lat ?? '', r.lng ?? '', r.accuracy ?? '',
      r.generalized ? 'true' : 'false', r.clockConfidence, r.notes,
    ].map(csvCell).join(','))
  }
  return lines.join('\n')
}

export function toGeoJson(sightings: Sighting[], opts: ExportOptions = {}): string {
  const data = rows(sightings, opts)
  return JSON.stringify({
    type: 'FeatureCollection',
    features: data
      .filter((r) => r.lat != null && r.lng != null)
      .map((r) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: {
          id: r.id, scientificName: r.sciName, commonName: r.commonName,
          individualCount: r.count, eventDate: r.isoTime,
          coordinatesGeneralized: r.generalized,
          coordinateUncertaintyInMeters: r.accuracy,
          clockConfidence: r.clockConfidence, occurrenceRemarks: r.notes,
        },
      })),
  }, null, 2)
}

/** Hand the file to the browser. Local only — nothing is uploaded. */
export function download(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

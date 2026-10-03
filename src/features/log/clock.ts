/**
 * The device clock is not trusted.
 *
 * The failure this guards against: a cheap Android fully drains overnight on a
 * two-week trip and boots to a manufacturer default date, with no network to
 * resync NTP. Those sightings would sort to the wrong end of the log, form a
 * bogus trip, and rewrite the life list's first-seen dates.
 *
 * Detection rests on ONE durable fact: wall-clock time, as this app has
 * observed it, only ever moves forward. `lastSeenWall` is therefore a
 * high-water mark that is never lowered — an earlier implementation
 * overwrote the reference on every launch, which made it impossible to
 * observe the backwards jump at all.
 *
 * `performance.now()` resets to zero each page load, so it is only useful
 * WITHIN a session and is deliberately not persisted.
 */
import { getMeta, setMeta } from '../../data/db'
import type { ClockConfidence } from '../../data/db'

const HIGH_WATER_KEY = 'clockHighWater'

/**
 * The build's own timestamp. Any wall clock earlier than the build that runs
 * it is definitionally wrong — this catches a factory-default date on the
 * very first launch, before any high-water mark exists.
 */
const BUILD_TIME = Number(import.meta.env?.VITE_BUILD_TIME) || Date.parse('2026-09-01T00:00:00Z')

/** Advance the high-water mark. Never lowers it. */
export async function noteWallClock(now = Date.now()): Promise<void> {
  const seen = await getMeta<number>(HIGH_WATER_KEY, 0)
  if (now > seen) await setMeta(HIGH_WATER_KEY, now)
}

/** Call once on launch. Records the mark only if time has moved forward. */
export async function recordClockRef(): Promise<void> {
  await noteWallClock()
}

/**
 * Suspect when the clock reads earlier than a time this app has already seen,
 * or earlier than the build that is running.
 *
 * Deliberately NOT based on drift between wall time and `performance.now()`:
 * the page timer freezes while backgrounded on iOS, so a phone that sat in a
 * pocket would flag every subsequent sighting.
 */
export async function assessClock(now = Date.now()): Promise<ClockConfidence> {
  if (now < BUILD_TIME) return 'suspect'
  const seen = await getMeta<number>(HIGH_WATER_KEY, 0)
  // A small tolerance absorbs legitimate NTP corrections nudging time back.
  return seen > 0 && now < seen - 60_000 ? 'suspect' : 'trusted'
}

export function tzOffsetMinutes(at = new Date()): number {
  // Intl sign convention: minutes to ADD to UTC, so flip getTimezoneOffset.
  return -at.getTimezoneOffset()
}

/** Format an instant for a datetime-local input, in the device's own zone. */
export function toLocalInput(at: number): string {
  return new Date(at + tzOffsetMinutes(new Date(at)) * 60_000).toISOString().slice(0, 16)
}

/**
 * Parse a datetime-local value as device-local wall time. `valueAsNumber`
 * would read it AS UTC; `new Date('YYYY-MM-DDTHH:mm')` is local by spec.
 */
export function fromLocalInput(value: string): number | null {
  const d = new Date(value)
  return Number.isNaN(+d) ? null : +d
}

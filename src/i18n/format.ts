/**
 * Locale-correct formatting. Never hand-format a date or a number — VI uses
 * dd/MM/yyyy, DE uses dd.MM.yyyy and a comma decimal, and prices are VND.
 */
import i18n from './index'

const locale = () => i18n.language || 'en'

/**
 * `timeZone: 'UTC'` is for instants that were already shifted by a stored
 * offset (see groupByDay): formatting those in the reader's zone would apply
 * the offset a second time and push evening records onto the next day.
 */
export const formatDate = (d: Date | number, timeZone?: string) =>
  new Intl.DateTimeFormat(locale(), { day: '2-digit', month: 'short', year: 'numeric', timeZone }).format(d)

/**
 * The calendar date of an observation at the place it was made: the stored
 * offset is applied once and the result formatted in UTC. Every screen that
 * shows a sighting's date uses this, so one record never shows two dates.
 */
export const formatObservedDate = (at: number, tzOffsetMinutes: number) =>
  formatDate(at + tzOffsetMinutes * 60_000, 'UTC')

/**
 * With `tzOffsetMinutes` (a sighting's stored offset) the wall-clock time at the
 * place of observation is shown, whatever zone the reader is in now.
 */
export const formatTime = (d: Date | number, tzOffsetMinutes?: number) =>
  tzOffsetMinutes === undefined
    ? new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(d)
    : new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
        .format(new Date(d).getTime() + tzOffsetMinutes * 60_000)

export const formatNumber = (n: number) => new Intl.NumberFormat(locale()).format(n)

/** Byte sizes for pack downloads and storage readouts. */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1_000_000
  if (mb >= 1000) return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(mb / 1000)} GB`
  return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(mb)} MB`
}

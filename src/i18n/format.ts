/**
 * Locale-correct formatting. Never hand-format a date or a number — VI uses
 * dd/MM/yyyy, DE uses dd.MM.yyyy and a comma decimal, and prices are VND.
 */
import i18n from './index'

const locale = () => i18n.language || 'en'

export const formatDate = (d: Date | number) =>
  new Intl.DateTimeFormat(locale(), { day: '2-digit', month: 'short', year: 'numeric' }).format(d)

export const formatTime = (d: Date | number) =>
  new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(d)

export const formatNumber = (n: number) => new Intl.NumberFormat(locale()).format(n)

/** Byte sizes for pack downloads and storage readouts. */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1_000_000
  if (mb >= 1000) return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(mb / 1000)} GB`
  return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(mb)} MB`
}

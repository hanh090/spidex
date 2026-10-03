/**
 * Carries the launch integrity result to the UI. The check runs in main.tsx
 * before React has anything to ask, so the result is parked here and the
 * banner subscribes.
 */
import { useSyncExternalStore } from 'react'
import type { IntegrityReport } from './integrity'

export interface IntegrityNotice {
  userDataLost: boolean
  packDataLost: boolean
}

const NONE: IntegrityNotice = { userDataLost: false, packDataLost: false }
let notice: IntegrityNotice = NONE
const listeners = new Set<() => void>()

const emit = () => listeners.forEach((l) => l())

export function publishIntegrity(report: Pick<IntegrityReport, 'userDataLost' | 'packDataLost'>): void {
  notice = report.userDataLost || report.packDataLost
    ? { userDataLost: report.userDataLost, packDataLost: report.packDataLost }
    : NONE
  emit()
}

export function dismissIntegrity(): void {
  notice = NONE
  emit()
}

export const useIntegrityNotice = (): IntegrityNotice =>
  useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => notice)

/**
 * Non-blocking notices above the routed screen: "update required" and the
 * storage-eviction warning. Neither stops the user — offline use is the whole
 * point of the app — they only say what happened and offer the next step.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { checkUpdateRequired, applyUpdate, showRequiredBanner, useUpdateState } from '../features/update/update-store'
import { dismissIntegrity, useIntegrityNotice } from '../data/integrity-notice'

const bar = {
  flex: 'none', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  padding: 'var(--space-2) var(--gutter-sm)',
  background: 'var(--panel)', borderBottom: 'var(--hair) solid var(--ink)',
  font: 'var(--type-meta)', color: 'var(--ink)',
} as const

const button = {
  minHeight: 'var(--tap-min)', padding: '0 var(--space-3)',
  background: 'var(--paper)', border: 'var(--hair) solid var(--ink)', color: 'var(--ink)',
  font: '600 14px/1 var(--font-sans)',
} as const

export function Notices() {
  const { t } = useTranslation()
  const update = useUpdateState()
  const integrity = useIntegrityNotice()
  const [updating, setUpdating] = useState(false)

  // Version check at startup and whenever connectivity returns.
  useEffect(() => {
    void checkUpdateRequired()
    const onOnline = () => { void checkUpdateRequired() }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  const lost = integrity.userDataLost || integrity.packDataLost

  return (
    <>
      {showRequiredBanner(update) && (
        <div role="status" style={bar}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <strong>{t('update.requiredTitle')}</strong>
            <div>{t('update.requiredBody')}</div>
          </div>
          <button
            style={button}
            disabled={updating}
            onClick={() => { setUpdating(true); void applyUpdate().finally(() => setUpdating(false)) }}
          >
            {t('update.reload')}
          </button>
        </div>
      )}
      {lost && (
        <div role="alert" style={bar}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <strong>{t('storage.lostTitle')}</strong>
            <div>{integrity.userDataLost ? t('storage.lostUser') : t('storage.lostPacks')}</div>
          </div>
          <button style={button} onClick={dismissIntegrity}>{t('storage.dismiss')}</button>
        </div>
      )}
    </>
  )
}

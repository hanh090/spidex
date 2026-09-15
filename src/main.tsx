import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from './i18n'
import './styles/base.css'
import { App } from './app/App'
import { registerSW } from 'virtual:pwa-register'
import { recordClockRef } from './features/log/clock'
import { checkIntegrity, recordUserDataCounts } from './data/integrity'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)

/**
 * 'prompt', never automatic: a service worker update must not swap content
 * mid-session in the field. Phase 6 adds the forced-update path for clients
 * below minClientVersion.
 */
/**
 * `registerType: 'prompt'` only prompts if a handler exists. Without one the
 * update never activates and the update.* strings can never render — the
 * client silently stays on an old build forever, which Phase 6's
 * minClientVersion path depends on being fixable.
 */
const updateSW = registerSW({
  immediate: false,
  onNeedRefresh() {
    // Deliberately a confirm rather than an auto-reload: an update must never
    // swap content out from under someone mid-session in the field.
    const msg = i18n.t('update.available')
    const yes = i18n.t('update.reload')
    if (window.confirm(`${msg}\n\n${yes}?`)) void updateSW(true)
  },
})

/**
 * Launch checks. The clock reference is paired with monotonic uptime so a
 * backward wall-clock jump on a drained device is detectable later.
 *
 * The integrity check covers pack AND user data: eviction is per-origin and
 * takes both, and a lost sighting is unrecoverable where a lost pack is not.
 */
void (async () => {
  await recordClockRef()
  const report = await checkIntegrity()
  if (report.userDataLost) {
    console.error(
      '[spidex] user data loss detected:',
      `sightings ${report.userData.actualSightings}/${report.userData.expectedSightings},`,
      `photos ${report.userData.actualPhotos}/${report.userData.expectedPhotos}`,
    )
  }
  if (report.packDataLost) {
    console.warn('[spidex] pack data incomplete — re-download needed', { online: report.online })
  }
  await recordUserDataCounts()
})()

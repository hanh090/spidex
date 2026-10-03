import { useTranslation } from 'react-i18next'
import type { Sighting } from '../../data/db'
import { Badge } from '../../ui/primitives'
import { useAuth } from '../auth/auth-context'
import { badgeFor, type BadgeState } from './engine'

const TONE: Record<BadgeState, 'muted' | 'ok' | 'warn' | 'accent'> = {
  queued: 'muted', synced: 'ok', conflict: 'warn', failed: 'warn',
}

/**
 * Per-record sync state. Guests (and records not stamped with a user) have
 * nothing to sync, so they render nothing at all.
 */
export function SyncBadge({ sighting }: { sighting: Pick<Sighting, 'userId' | 'syncState'> }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  if (!user || !sighting.userId || sighting.userId !== user.id) return null
  const state = badgeFor(sighting.syncState)
  return <Badge tone={TONE[state]}>{t(`sync.state.${state}`)}</Badge>
}

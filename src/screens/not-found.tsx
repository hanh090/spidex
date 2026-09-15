/**
 * Unknown route.
 *
 * Reached from a stale bookmark, a shared link to a species that was removed
 * with its pack, or a typo. The shell treats it as a pushed screen, so there
 * is no tab bar here — the single action back to Explore is the way out, and
 * it must always be present.
 */
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, EmptyState } from '../ui/primitives'

export function NotFound() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <EmptyState
      title={t('notFound.title')}
      fix={t('notFound.fix')}
      action={<Button variant="primary" onClick={() => navigate('/')}>{t('notFound.home')}</Button>}
    />
  )
}

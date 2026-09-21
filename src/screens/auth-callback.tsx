import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { exchangeOAuthCode } from '../features/auth/auth-api'
import { useAuth } from '../features/auth/auth-context'
import { Button, EmptyState } from '../ui/primitives'

export function AuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { refreshUser } = useAuth()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code = searchParams.get('code')
    if (!code) {
      setError('Missing authorization code in callback URL.')
      return
    }

    let active = true
    exchangeOAuthCode(code)
      .then(async () => {
        if (!active) return
        await refreshUser()
        navigate('/', { replace: true })
      })
      .catch((err) => {
        if (!active) return
        setError(err.message || 'Authentication exchange failed.')
      })

    return () => {
      active = false
    }
  }, [searchParams, navigate, refreshUser])

  if (error) {
    return (
      <div style={{ height: '100%', background: 'var(--paper)', display: 'grid', placeItems: 'center' }}>
        <EmptyState
          title="Sign in failed"
          fix={error}
          action={<Button variant="primary" onClick={() => navigate('/')}>Return to Spidex</Button>}
        />
      </div>
    )
  }

  return (
    <div style={{ height: '100%', background: 'var(--paper)', display: 'grid', placeItems: 'center', padding: 'var(--space-6)' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="t-heading" style={{ marginBottom: 'var(--space-2)' }}>Signing you in…</div>
        <p className="t-body" style={{ color: 'var(--ink-muted)' }}>Connecting with WorkOS AuthKit</p>
      </div>
    </div>
  )
}

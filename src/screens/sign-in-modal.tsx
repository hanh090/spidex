import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../features/auth/auth-context'
import { Button, Meta } from '../ui/primitives'
import { IconClose } from '../ui/icons'

interface Props {
  open: boolean
  onClose: () => void
}

export function SignInModal({ open, onClose }: Props) {
  const { t } = useTranslation()
  const { signIn, signUp, loginWithOAuth } = useAuth()
  const [isRegister, setIsRegister] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      if (isRegister) {
        await signUp(email, password, firstName, lastName)
      } else {
        await signIn(email, password)
      }
      onClose()
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleOAuth = async (provider: 'GoogleOAuth' | 'authkit') => {
    setError(null)
    try {
      await loginWithOAuth(provider)
    } catch (err: any) {
      setError(err.message || 'Failed to start OAuth')
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        style={{
          position: 'fixed', inset: 0, background: 'var(--scrim)',
          zIndex: 30, opacity: 1, transition: 'opacity var(--move-sheet) var(--ease)',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isRegister ? t('auth.registerTitle') : t('auth.signInTitle')}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(92vw, 400px)',
          maxHeight: '90vh',
          background: 'var(--panel)',
          border: 'var(--hair) solid var(--ink)',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.25)',
          zIndex: 31,
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--space-4) var(--gutter-sm)',
          borderBottom: 'var(--hair) solid var(--line)',
        }}>
          <div className="t-heading" style={{ fontSize: 18 }}>
            {isRegister ? t('auth.registerTitle') : t('auth.signInTitle')}
          </div>
          <button
            onClick={onClose}
            aria-label={t('nav.close')}
            style={{
              minWidth: 'var(--tap-min)', height: 'var(--tap-min)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--ink)', background: 'none', border: 'none', cursor: 'pointer',
            }}
          >
            <IconClose />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 'var(--space-5) var(--gutter-sm)' }}>
          {error && (
            <div style={{
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-4)',
              background: 'rgba(184, 35, 44, 0.08)',
              border: 'var(--hair) solid var(--accent)',
              color: 'var(--accent)',
              fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {isRegister && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                <div>
                  <label className="t-meta" style={{ display: 'block', marginBottom: 4 }}>{t('auth.firstName')}</label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jane"
                    style={{
                      width: '100%', padding: '10px 12px',
                      background: 'var(--paper)', border: 'var(--hair) solid var(--ink)',
                      color: 'var(--ink)', font: 'inherit',
                    }}
                  />
                </div>
                <div>
                  <label className="t-meta" style={{ display: 'block', marginBottom: 4 }}>{t('auth.lastName')}</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Doe"
                    style={{
                      width: '100%', padding: '10px 12px',
                      background: 'var(--paper)', border: 'var(--hair) solid var(--ink)',
                      color: 'var(--ink)', font: 'inherit',
                    }}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="t-meta" style={{ display: 'block', marginBottom: 4 }}>{t('auth.email')}</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="naturalist@example.com"
                style={{
                  width: '100%', padding: '10px 12px',
                  background: 'var(--paper)', border: 'var(--hair) solid var(--ink)',
                  color: 'var(--ink)', font: 'inherit',
                }}
              />
            </div>

            <div>
              <label className="t-meta" style={{ display: 'block', marginBottom: 4 }}>{t('auth.password')}</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: '100%', padding: '10px 12px',
                  background: 'var(--paper)', border: 'var(--hair) solid var(--ink)',
                  color: 'var(--ink)', font: 'inherit',
                }}
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              full
              disabled={submitting}
              style={{ marginTop: 'var(--space-2)' }}
            >
              {submitting ? t('auth.submitting') : isRegister ? t('auth.createAccount') : t('auth.signIn')}
            </Button>
          </form>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
            margin: 'var(--space-4) 0',
          }}>
            <div style={{ flex: 1, height: 'var(--hair)', background: 'var(--line)' }} />
            <Meta tone="muted">{t('auth.or')}</Meta>
            <div style={{ flex: 1, height: 'var(--hair)', background: 'var(--line)' }} />
          </div>

          <Button
            type="button"
            variant="secondary"
            full
            onClick={() => handleOAuth('authkit')}
          >
            {t('auth.continueWith')}
          </Button>

          <div style={{
            marginTop: 'var(--space-4)', textAlign: 'center',
            fontSize: 13, color: 'var(--ink-muted)',
          }}>
            {isRegister ? (
              <>
                {t('auth.haveAccount')}{' '}
                <button
                  type="button"
                  onClick={() => setIsRegister(false)}
                  style={{
                    background: 'none', border: 'none', color: 'var(--accent)',
                    cursor: 'pointer', textDecoration: 'underline', font: 'inherit',
                  }}
                >
                  {t('auth.signIn')}
                </button>
              </>
            ) : (
              <>
                {t('auth.noAccount')}{' '}
                <button
                  type="button"
                  onClick={() => setIsRegister(true)}
                  style={{
                    background: 'none', border: 'none', color: 'var(--accent)',
                    cursor: 'pointer', textDecoration: 'underline', font: 'inherit',
                  }}
                >
                  {t('auth.createOne')}
                </button>
              </>
            )}
          </div>

          <div style={{
            marginTop: 'var(--space-5)', padding: 'var(--space-3)',
            background: 'var(--paper)', border: 'var(--hair) solid var(--line)',
            textAlign: 'center',
          }}>
            <Meta tone="muted">
              {t('auth.guestNote')}
            </Meta>
          </div>
        </div>
      </div>
    </>
  )
}

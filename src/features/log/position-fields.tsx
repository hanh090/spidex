/**
 * Latitude and longitude typed by hand.
 *
 * Used when GPS gave nothing (no fix, denied, no hardware) and when a saved
 * sighting's position needs correcting. Plain text inputs with a decimal
 * keypad rather than type="number": number inputs reject the decimal comma de
 * and vi users type, and silently report an empty value when they do.
 * Clearing both fields means "no position".
 */
import { useTranslation } from 'react-i18next'
import { Meta } from '../../ui/primitives'

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', minHeight: 'var(--tap-min)',
  background: 'var(--paper)', border: 'var(--hair) solid var(--line)',
  color: 'var(--ink)', padding: '0 var(--space-2)', font: 'var(--type-body)',
}

export function PositionFields({ lat, lng, onChange, invalid }: {
  lat: string
  lng: string
  onChange: (next: { lat: string; lng: string }) => void
  /** Shows the range hint as an error. */
  invalid?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
        <input
          value={lat}
          onChange={(e) => onChange({ lat: e.target.value, lng })}
          inputMode="decimal"
          autoComplete="off"
          placeholder={t('log.latitude')}
          aria-label={t('log.latitude')}
          aria-invalid={invalid || undefined}
          style={inputStyle}
        />
        <input
          value={lng}
          onChange={(e) => onChange({ lat, lng: e.target.value })}
          inputMode="decimal"
          autoComplete="off"
          placeholder={t('log.longitude')}
          aria-label={t('log.longitude')}
          aria-invalid={invalid || undefined}
          style={inputStyle}
        />
      </div>
      <Meta tone={invalid ? 'warn' : undefined}>{t('log.positionHint')}</Meta>
    </div>
  )
}

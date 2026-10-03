/**
 * Bird-voice playback on the species page.
 *
 * Audio streams from the source archive — it is never in the pack, so this is
 * a network feature: rows render regardless (a downloaded pack must show what
 * it holds), but the control disables offline with a calm note, matching how
 * the app treats connectivity everywhere else.
 *
 * One row per recording: play/pause, a seekable progress bar, duration, and
 * the recordist + licence — attribution is part of the licence terms, not
 * decoration.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SpeciesSound } from '../../data/pack-manifest'
import { useOnline } from '../../lib/net'

// Pack links are author data: render only http(s), never javascript:/data:.
const isHttpUrl = (u?: string): u is string => !!u && /^https?:\/\//i.test(u)

function fmt(sec?: number): string {
  if (!sec || !Number.isFinite(sec)) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function SoundList({ sounds }: { sounds: SpeciesSound[] }) {
  const { t } = useTranslation()
  const online = useOnline()
  if (!sounds.length) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {!online && (
        <p className="t-meta" style={{ color: 'var(--warn)', margin: 0 }}>{t('species.soundsOffline')}</p>
      )}
      {sounds.map((s) => (
        <SoundRow key={s.id} sound={s} enabled={online} />
      ))}
    </div>
  )
}

function SoundRow({ sound, enabled }: { sound: SpeciesSound; enabled: boolean }) {
  const { t } = useTranslation()
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => () => { audio.current?.pause() }, [])

  const fail = () => {
    // Drop the element so Retry builds a fresh one instead of reusing a
    // media element stuck in its error state.
    audio.current?.pause()
    audio.current = null
    setPlaying(false)
    setProgress(0)
    setFailed(true)
  }

  const toggle = () => {
    setFailed(false)
    if (!audio.current) {
      const el = new Audio(sound.url)
      el.preload = 'metadata'
      el.addEventListener('timeupdate', () => {
        setProgress(el.duration ? el.currentTime / el.duration : 0)
      })
      el.addEventListener('ended', () => { setPlaying(false); setProgress(0) })
      el.addEventListener('error', () => { if (audio.current === el) fail() })
      audio.current = el
    }
    if (playing) {
      audio.current.pause()
      setPlaying(false)
    } else {
      const el = audio.current
      void el.play().then(() => setPlaying(true)).catch((e: unknown) => {
        // Autoplay refusals and interrupted loads are not a broken recording.
        if (audio.current === el && (el.error || (e as Error)?.name === 'NotSupportedError')) fail()
        else setPlaying(false)
      })
    }
  }

  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = audio.current
    if (!el?.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    el.currentTime = ((e.clientX - rect.left) / rect.width) * el.duration
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
      border: 'var(--hair) solid var(--line)', borderRadius: 'var(--radius-tap)',
      padding: 'var(--space-2) var(--space-3)', background: 'var(--paper)',
    }}>
      <button
        onClick={toggle}
        disabled={!enabled}
        aria-label={playing ? t('species.pause') : t('species.play')}
        aria-pressed={playing}
        style={{
          flex: 'none', width: 'var(--tap-min)', height: 'var(--tap-min)',
          borderRadius: '50%', display: 'grid', placeItems: 'center',
          background: enabled ? 'var(--accent)' : 'var(--line)',
          color: 'var(--paper)', border: 0,
          cursor: enabled ? 'pointer' : 'default',
        }}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><rect x="2" y="1" width="3.5" height="12" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" fill="currentColor" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M3 1.5v11l9-5.5z" fill="currentColor" /></svg>
        )}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          role="slider"
          aria-label={t('species.seek')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          onPointerDown={seek}
          style={{ minHeight: 'var(--tap-min)', display: 'flex', alignItems: 'center', cursor: 'pointer' }}
        >
          <div style={{ height: 4, width: '100%', background: 'var(--line)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${progress * 100}%`, height: '100%', background: 'var(--accent)' }} />
          </div>
        </div>
        {failed && (
          <div role="alert" className="t-meta" style={{ color: 'var(--warn)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <span>{t('species.soundError')}</span>
            <button
              onClick={toggle}
              style={{
                minHeight: 'var(--tap-min)', padding: '0 var(--space-3)', background: 'none',
                border: 'var(--hair) solid var(--warn)', borderRadius: 'var(--radius-tap)',
                color: 'inherit', font: 'inherit', cursor: 'pointer',
              }}
            >
              {t('species.soundRetry')}
            </button>
          </div>
        )}
        <div className="t-meta" style={{ color: 'var(--ink-muted)', overflowWrap: 'anywhere' }}>
          {[sound.type, fmt(sound.durationSec)].filter(Boolean).join(' · ')}
          {(sound.type || sound.durationSec) && ' · '}
          {/* The recordist links to the recording page; the licence links to
              its canonical text — CC attribution asks for both. */}
          {isHttpUrl(sound.sourceUrl)
            ? <a href={sound.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{sound.credit}</a>
            : sound.credit}
          {' · '}
          {isHttpUrl(sound.licenseUrl)
            ? <a href={sound.licenseUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{sound.license}</a>
            : sound.license}
        </div>
      </div>
    </div>
  )
}

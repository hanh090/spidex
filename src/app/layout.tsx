/**
 * App shell: header (menu + global scope + connectivity), the routed screen,
 * and a three-tab bar.
 *
 * Three tabs, never four — Explore, Identify, Sightings. A fourth candidate is
 * either a push from one of these or a drawer item; "Log unknown" is a pinned
 * action on Sightings, not a tab.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Drawer } from './drawer'
import { useScrollRestoration } from './use-scroll-restoration'
import { IconExplore, IconIdentify, IconSightings, IconMenu } from '../ui/icons'
import { useOnline } from '../lib/net'
import { useActivePackName } from '../features/guide/use-active-pack-name'
import {
  applyTheme, readThemeSetting, resolveTheme, writeThemeSetting, type ThemeSetting,
} from '../lib/theme'
import {
  estimate, schedulePersistRequests, type PersistState, type StorageEstimate,
} from '../lib/storage'

export function Layout() {
  const { t } = useTranslation()
  const online = useOnline()
  const location = useLocation()
  const mainRef = useRef<HTMLElement | null>(null)
  const { name: packName } = useActivePackName()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [themeSetting, setThemeSetting] = useState<ThemeSetting>(readThemeSetting)
  const [persist, setPersist] = useState<PersistState | null>(null)
  const [usage, setUsage] = useState<StorageEstimate | null>(null)

  // Top-level destinations that display the main tab bar and scope header.
  // Pushed subordinate screens (SpeciesDetail, Compare, LogSighting, Packs)
  // own their full height and top navigation bar, matching iOS/Android native patterns.
  const isMainTab = location.pathname === '/' || location.pathname === '/identify' || location.pathname === '/sightings'

  // Paint the theme, and follow the system while the setting is 'system'.
  useEffect(() => {
    applyTheme(resolveTheme(themeSetting))
    if (themeSetting !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme(resolveTheme('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [themeSetting])

  useEffect(() => {
    schedulePersistRequests(setPersist)
    void estimate().then(setUsage)
  }, [])

  // Top on push, restored position on back. See use-scroll-restoration.
  useScrollRestoration(mainRef)

  const onTheme = (next: ThemeSetting) => {
    setThemeSetting(next)
    writeThemeSetting(next)
  }

  const tabs = useMemo(() => ([
    { to: '/', end: true, label: t('nav.explore'), Icon: IconExplore },
    { to: '/identify', end: false, label: t('nav.identify'), Icon: IconIdentify },
    { to: '/sightings', end: false, label: t('nav.sightings'), Icon: IconSightings },
  ]), [t])

  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', background: 'var(--paper)', overflow: 'hidden' }}>

      {/*
        Header — scope is global and shown on top-level tabs.
        The menu button is a BOXED 44px control.
        Pushed screens hide this header to present their own native Back navigation.
      */}
      {isMainTab && (
        <header style={{
          flex: 'none', width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: 'max(14px, env(safe-area-inset-top)) var(--gutter-sm) 12px',
          background: 'var(--panel)', borderBottom: 'var(--hair) solid var(--line)',
        }}>
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label={t('nav.menu')}
            style={{
              width: 44, height: 44, minHeight: 44, flex: 'none',
              display: 'grid', placeItems: 'center',
              background: 'var(--paper)', border: 'var(--hair) solid var(--ink)',
              color: 'var(--ink)',
            }}
          >
            <IconMenu size={22} />
          </button>

          <button
            onClick={() => setDrawerOpen(true)}
            style={{
              flex: 1, minWidth: 0, textAlign: 'left', minHeight: 0,
              background: 'none', color: 'var(--ink)',
            }}
          >
            <div style={{
              font: '600 15px/1.2 var(--font-sans)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {packName ?? t('scope.none')}
            </div>
            <div className="t-meta" style={{ color: 'var(--ink-muted)', marginTop: 2 }}>
              {t('scope.sub')}
            </div>
          </button>

          {/* Offline is the normal case, so it is stated calmly, never as an error. */}
          {!online && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, flex: 'none',
              font: 'var(--type-meta)', color: 'var(--ink)',
            }}>
              <span aria-hidden style={{ width: 8, height: 8, background: 'var(--warn)', display: 'block' }} />
              {t('net.offline')}
            </div>
          )}
        </header>
      )}

      <main ref={mainRef} className="scroll-y" style={{ flex: 1, minHeight: 0, width: '100%' }}>
        <Outlet />
      </main>

      {/*
        Bottom Tab Bar — displayed only at top-level destinations (Explore, Identify, Sightings).
        Pushed screens hide the bottom bar to provide maximum vertical area for content and actions.
      */}
      {isMainTab && (
        <nav
          aria-label={t('nav.menu')}
          style={{
            flex: 'none', width: '100%', display: 'flex', background: 'var(--paper)',
            borderTop: 'var(--hair) solid var(--ink)',
            paddingBottom: 'max(0px, env(safe-area-inset-bottom))',
          }}
        >
          {tabs.map(({ to, end, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={(e) => {
                // Mobile-native pattern: tapping the already-active tab scrolls the screen to top
                if (location.pathname === to) {
                  e.preventDefault()
                  const scrollable = mainRef.current?.querySelector('.scroll-y') ?? mainRef.current
                  scrollable?.scrollTo({ top: 0, behavior: 'smooth' })
                }
              }}
              style={({ isActive }) => ({
                flex: 1, minHeight: 'var(--tap-primary)',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 'var(--space-1)',
                padding: 'var(--space-2) var(--space-1)',
                color: isActive ? 'var(--ink)' : 'var(--ink-muted)',
                borderTop: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                marginTop: '-1.5px',
              })}
            >
              {({ isActive }) => (
                <>
                  <Icon />
                  {/* No nowrap: German labels are ~30% longer and must wrap. */}
                  <span className="t-tab" style={{ textAlign: 'center', color: isActive ? 'var(--ink)' : 'var(--ink-muted)' }}>
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        themeSetting={themeSetting}
        onTheme={onTheme}
        persist={persist}
        usage={usage}
      />
    </div>
  )
}

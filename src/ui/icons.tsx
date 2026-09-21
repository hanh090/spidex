/**
 * Inline stroke icons on a 24px grid. Never emoji, never a dingbat — they
 * cannot be recoloured per theme and they render differently per platform.
 */
type P = { size?: number; className?: string }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

export const IconExplore = ({ size = 22 }: P) => (
  <svg {...base(size)}>
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
  </svg>
)

export const IconIdentify = ({ size = 22 }: P) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" /><path d="M11 8v3l2 1.5" />
  </svg>
)

export const IconSightings = ({ size = 22 }: P) => (
  <svg {...base(size)}>
    <path d="M5 3h14v18l-7-4-7 4z" /><path d="M9 8h6" />
  </svg>
)

export const IconMenu = ({ size = 22 }: P) => (
  <svg {...base(size)} strokeWidth={2.4}>
    <path d="M2 5H22" /><path d="M2 12H22" /><path d="M2 19H22" />
  </svg>
)

/** Three decreasing rules — the filter affordance. */
export const IconFilter = ({ size = 17 }: P) => (
  <svg {...base(size)} viewBox="0 0 18 18" strokeWidth={2}>
    <path d="M1 3H17" /><path d="M4 9H14" /><path d="M7 15H11" />
  </svg>
)

export const IconClose = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
)

export const IconChevron = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M9 5l7 7-7 7" /></svg>
)

export const IconPlus = ({ size = 20 }: P) => (
  <svg {...base(size)}><path d="M12 5v14" /><path d="M5 12h14" /></svg>
)

/** Struck-through signal arcs: offline is a state, not an error. */
export const IconOffline = ({ size = 15 }: P) => (
  <svg {...base(size)}>
    <path d="M2 8a15 15 0 0 1 20 0" /><path d="M5.5 12a10 10 0 0 1 13 0" />
    <circle cx="12" cy="18" r="1.1" fill="currentColor" stroke="none" />
    <path d="M3 3l18 18" strokeWidth="2.2" />
  </svg>
)

export const IconCheck = ({ size = 18 }: P) => (
  <svg {...base(size)}><path d="M4 12.5l5 5L20 6.5" /></svg>
)

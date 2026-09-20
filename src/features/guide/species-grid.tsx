/**
 * The species grid.
 *
 * Two columns, not three. A field guide's whole job is visual match, and at
 * 390px a three-column grid gives each bird a 104px plate — below the size
 * where you can separate a drongo from a treepie at arm's length. Two columns
 * roughly doubles it. Wider viewports add columns rather than inflating two.
 *
 * Plates are 4:3, matching the shape most field photographs are actually
 * taken in, so the subject is not cropped to a square that discards the tail.
 *
 * The name block reserves two lines. Vietnamese common names routinely wrap
 * ("Đuôi cụt cánh xanh"), and without a reserved height every row in the grid
 * settles at a different baseline.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { StoredSpecies } from '../../data/db'
import { resolve } from '../../data/localized'
import { inferSpeciesArchetype } from '../../data/archetypes'

export function SpeciesGrid({ species, baseUrl }: { species: StoredSpecies[]; baseUrl: string }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
      gap: 'var(--space-4) var(--space-3)', padding: 'var(--gutter-sm)',
      alignItems: 'start',
    }}>
      {species.map((sp) => (
        <Link
          key={sp.uid}
          to={`/species/${sp.uid}`}
          style={{ color: 'var(--ink)', display: 'block', minWidth: 0 }}
        >
          <Plate sp={sp} baseUrl={baseUrl} />
          {/*
            The reserved height sits on the name PAIR, not on the common name
            alone. Reserving it on the name alone opens a gap between a
            one-line name and the scientific name beneath it, which reads as
            two unrelated labels rather than one caption.
          */}
          <div style={{ marginTop: 'var(--space-2)', minHeight: 'calc(2 * 1.25 * 17.5px + 1.3 * 14px)' }}>
            <div className="t-name" style={{ textWrap: 'pretty' }}>{resolve(sp.commonNames)}</div>
            <div className="t-sci">{sp.sciName}</div>
          </div>
        </Link>
      ))}
    </div>
  )
}

export function Plate({ sp, baseUrl, size, ratio = '4 / 3' }: {
  sp: StoredSpecies
  baseUrl: string
  size?: number
  ratio?: string
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const first = sp.images[0]
  const archetype = inferSpeciesArchetype(sp)
  const fallbackUrl = `${baseUrl}/img/${archetype}`
  const targetUrl = !first || imgFailed ? fallbackUrl : `${baseUrl}/${first.thumbUrl}`
  const isArchetype = !first || imgFailed || /archetype/i.test(first.thumbUrl)
  const title = isArchetype
    ? `${sp.sciName} · Spidex Archetype Plate`
    : `${first?.credit} · ${first?.license}`

  return (
    <div style={{
      aspectRatio: ratio, width: size, background: 'var(--panel)',
      border: 'var(--hair) solid var(--line)', borderRadius: 'var(--radius-tap)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      <img
        src={targetUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => {
          if (!imgFailed && first && `${baseUrl}/${first.thumbUrl}` !== fallbackUrl) {
            setImgFailed(true)
          }
        }}
        /* Attribution stays reachable on every image, including thumbnails,
           where a visible caption would not be legible. */
        title={title}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </div>
  )
}

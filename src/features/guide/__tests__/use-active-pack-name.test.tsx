// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db, setActivePackId } from '../../../data/db'
import { useActivePackName } from '../use-active-pack-name'
import type { PackManifest } from '../../../data/pack-manifest'

let root: Root
let host: HTMLDivElement

function Probe() {
  const { name, loading } = useActivePackName()
  return <div>{loading ? 'Loading' : name ?? 'No pack mounted'}</div>
}

async function until(expected: string) {
  for (let i = 0; i < 50; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    if (host.textContent === expected) return
  }
  expect(host.textContent).toBe(expected)
}

beforeEach(async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await db.packs.clear()
  await db.meta.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('mounted-pack header', () => {
  it('updates after a pack is installed and selected without remounting', async () => {
    await act(async () => root.render(<Probe />))
    await until('No pack mounted')

    const manifest = { name: { en: 'Birds (fixture)' } } as PackManifest
    await act(async () => {
      await db.packs.put({ id: 'bird-min', manifest, version: 1, tier: 'thumb', installedAt: Date.now(), bytes: 0 })
      await setActivePackId('bird-min')
    })
    await until('Birds (fixture)')
  })
})

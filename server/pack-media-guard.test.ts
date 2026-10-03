import { describe, expect, it } from 'vitest'
import { overwriteDecision } from '../scripts/lib/pack-media-guard.mjs'

const a = new Uint8Array([1, 2, 3])
const b = new Uint8Array([1, 2, 4])

describe('upload-pack-media overwrite guard', () => {
  it('uploads when the key is free', () => {
    expect(overwriteDecision(null, a, false)).toBe('upload')
  })
  it('skips identical bytes without needing --force', () => {
    expect(overwriteDecision(new Uint8Array([1, 2, 3]), a, false)).toBe('skip')
  })
  it('refuses to replace a different object, whatever its size', () => {
    expect(overwriteDecision(b, a, false)).toBe('refuse')
    expect(overwriteDecision(new Uint8Array([1]), a, false)).toBe('refuse')
  })
  it('overwrites a different object only with --force', () => {
    expect(overwriteDecision(b, a, true)).toBe('upload')
  })
})

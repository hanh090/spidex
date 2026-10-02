import { describe, it, expect, vi, afterEach } from 'vitest'
import { uploadPackFiles } from './submissions-api'

afterEach(() => vi.unstubAllGlobals())

describe('uploadPackFiles', () => {
  it('stops dispatching files after a failure and surfaces the error', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('f0')) return new Response(JSON.stringify({ error: 'too big' }), { status: 413 })
      return new Response('{"ok":true}')
    }))
    const files = Array.from({ length: 40 }, (_, i) => ({ path: `f${i}`, file: new Blob(['x']) }))
    await expect(uploadPackFiles('sub', files)).rejects.toThrow('too big')
    // Only the first pool of in-flight requests may have started.
    expect(calls.length).toBeLessThanOrEqual(4)
  })

  it('uploads everything and reports progress on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}')))
    const progress: number[] = []
    const files = Array.from({ length: 6 }, (_, i) => ({ path: `f${i}`, file: new Blob(['x']) }))
    await uploadPackFiles('sub', files, (d) => progress.push(d))
    expect(progress).toHaveLength(6)
  })
})

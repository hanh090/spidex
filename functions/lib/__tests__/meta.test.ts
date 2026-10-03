import { describe, expect, it } from 'vitest'
import { onRequestGet } from '../../api/meta'
import { metaBody } from '../meta'

describe('/api/meta', () => {
  it('defaults to no minimum', async () => {
    const res = onRequestGet({ env: {} })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ minClientVersion: '0', apiVersion: 1 })
  })

  it('reports MIN_CLIENT_VERSION', async () => {
    expect(await onRequestGet({ env: { MIN_CLIENT_VERSION: ' 0.2.0 ' } }).json()).toMatchObject({ minClientVersion: '0.2.0' })
  })

  it.each(['abc', '1.2.3.4', '-1', '', 5])('ignores a malformed value %s', (v) => {
    expect(metaBody({ MIN_CLIENT_VERSION: v }).minClientVersion).toBe('0')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchCurrentUser,
  signInWithPassword,
  signUpWithPassword,
  signOut,
} from '../auth-api'

describe('auth-api', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetchCurrentUser returns null when /api/auth/me has no user', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: null }),
    } as Response)

    const user = await fetchCurrentUser()
    expect(user).toBeNull()
  })

  it('fetchCurrentUser returns user object when session is active', async () => {
    const mockUser = {
      id: 'user-123',
      email: 'naturalist@spidex.vn',
      firstName: 'Lan',
      lastName: 'Nguyen',
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: mockUser }),
    } as Response)

    const user = await fetchCurrentUser()
    expect(user).toEqual(mockUser)
  })

  it('signInWithPassword sends credentials and returns user', async () => {
    const mockUser = { id: 'user-999', email: 'user@example.com' }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: mockUser }),
    } as Response)

    const result = await signInWithPassword('user@example.com', 'mypassword')
    expect(result).toEqual(mockUser)
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/password', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com', password: 'mypassword' }),
    }))
  })

  it('signInWithPassword throws error on failed login', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Invalid email or password' }),
    } as Response)

    await expect(signInWithPassword('bad@example.com', 'wrongpass')).rejects.toThrow('Invalid email or password')
  })

  it('signUpWithPassword sends registration payload and returns user', async () => {
    const mockUser = { id: 'user-new', email: 'new@example.com' }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: mockUser }),
    } as Response)

    const result = await signUpWithPassword('new@example.com', 'password123', 'John', 'Doe')
    expect(result).toEqual({ user: mockUser, pendingVerification: false })
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'new@example.com', password: 'password123', firstName: 'John', lastName: 'Doe' }),
    }))
  })

  it('signUpWithPassword reports a pending verification without a session', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ pendingVerification: true, user: { id: 'u1', email: 'a@b.c' } }),
    } as Response)

    const result = await signUpWithPassword('a@b.c', 'pw')
    expect(result.pendingVerification).toBe(true)
  })

  it('signOut calls /api/auth/logout', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response)

    await signOut()
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createMemoryPlatform } from '../../../platform/memory'
import type { NetworkPort } from '../../../platform/ports'
import {
  savePinterestApp,
  savePinterestSession,
} from '../../../state/project/pinterestConnectionStore'
import { openPinterestSession } from './pinterestSession'

describe('Pinterest session', () => {
  it('reuses a valid access token without making a network request', async () => {
    const platform = createMemoryPlatform()
    await savePinterestApp(platform.storage, platform.credentials, {
      clientId: 'app-id',
      clientSecret: 'secret',
      redirectUri: 'http://127.0.0.1:53682/pinterest/callback',
    })
    await savePinterestSession(platform.storage, platform.credentials, {
      token: {
        accessToken: 'access-valid',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() + 3_600_000,
        scope: ['boards:read'],
      },
      user: { id: 'u1', username: 'creator' },
    })
    const request = vi.fn<NetworkPort['request']>()
    platform.network = { request, stream: async function* () {} }

    const session = await openPinterestSession(
      platform,
      new AbortController().signal,
    )

    expect(session.accessToken).toBe('access-valid')
    expect(request).not.toHaveBeenCalled()
  })

  it('refreshes an expired token and persists the replacement', async () => {
    const platform = createMemoryPlatform()
    await savePinterestApp(platform.storage, platform.credentials, {
      clientId: 'app-id',
      clientSecret: 'secret',
      redirectUri: 'http://127.0.0.1:53682/pinterest/callback',
    })
    await savePinterestSession(platform.storage, platform.credentials, {
      token: {
        accessToken: 'access-expired',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() + 1_000,
        refreshTokenExpiresAt: Date.now() + 3_600_000,
        scope: ['boards:read'],
      },
      user: { id: 'u1', username: 'creator' },
    })
    const request = vi.fn<NetworkPort['request']>(async () => {
      const text = JSON.stringify({
        access_token: 'access-refreshed',
        expires_in: 3600,
        scope: 'boards:read,pins:read',
      })
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        text: async () => text,
        json: async <T,>() => JSON.parse(text) as T,
        arrayBuffer: async () => new ArrayBuffer(0),
      }
    })
    platform.network = { request, stream: async function* () {} }

    const session = await openPinterestSession(
      platform,
      new AbortController().signal,
    )

    expect(session.accessToken).toBe('access-refreshed')
    expect(session.connection).toMatchObject({
      hasAccessToken: true,
      hasRefreshToken: true,
      scope: ['boards:read', 'pins:read'],
      user: { username: 'creator' },
    })
    expect(request).toHaveBeenCalledOnce()
    expect(
      (request.mock.calls[0]?.[0].body as URLSearchParams).get('refresh_token'),
    ).toBe('refresh-1')
    expect(await platform.credentials.load('oauth:pinterest:access-token')).toBe(
      'access-refreshed',
    )
  })
})

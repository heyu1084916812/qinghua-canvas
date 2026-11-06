import { beforeEach, describe, expect, it } from 'vitest'
import {
  createMemoryCredentials,
  createMemoryStorage,
} from '../../platform/memory'
import type { CredentialPort, StoragePort } from '../../platform/ports'
import {
  clearPinterestConnection,
  clearPinterestSession,
  loadPinterestConnection,
  PINTEREST_CONNECTION_KEY,
  savePinterestApp,
  savePinterestSession,
  savePinterestToken,
} from './pinterestConnectionStore'

let storage: StoragePort
let credentials: CredentialPort

const app = {
  clientId: 'app-id',
  clientSecret: 'client-secret',
  redirectUri: 'http://127.0.0.1:53682/pinterest/callback',
}

beforeEach(() => {
  storage = createMemoryStorage()
  credentials = createMemoryCredentials()
})

describe('Pinterest connection store', () => {
  it('keeps the client secret out of presets and preserves it on app edits', async () => {
    await savePinterestApp(storage, credentials, app)

    const rows = await storage.query('presets', { id: PINTEREST_CONNECTION_KEY })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      clientId: 'app-id',
      redirectUri: app.redirectUri,
    })
    expect(JSON.stringify(rows[0])).not.toContain('client-secret')
    expect(await credentials.load('oauth:pinterest:client-secret')).toBe(
      'client-secret',
    )

    await savePinterestApp(storage, credentials, {
      clientId: 'app-id-2',
      redirectUri: app.redirectUri,
    })
    expect((await loadPinterestConnection(storage, credentials))?.clientId).toBe(
      'app-id-2',
    )
    expect(await credentials.load('oauth:pinterest:client-secret')).toBe(
      'client-secret',
    )
  })

  it('stores access and refresh tokens only in the credential port', async () => {
    await savePinterestApp(storage, credentials, app)
    const connection = await savePinterestSession(storage, credentials, {
      token: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: 123_000,
        refreshTokenExpiresAt: 456_000,
        scope: ['boards:read', 'pins:read'],
      },
      user: { id: 'u1', username: 'creator' },
    })

    expect(connection).toMatchObject({
      hasAccessToken: true,
      hasRefreshToken: true,
      expiresAt: 123_000,
      user: { id: 'u1', username: 'creator' },
    })
    expect(await credentials.load('oauth:pinterest:access-token')).toBe(
      'access-1',
    )
    expect(await credentials.load('oauth:pinterest:refresh-token')).toBe(
      'refresh-1',
    )
    const rows = await storage.query('presets', { id: PINTEREST_CONNECTION_KEY })
    expect(JSON.stringify(rows)).not.toContain('access-1')
    expect(JSON.stringify(rows)).not.toContain('refresh-1')

    const refreshed = await savePinterestToken(storage, credentials, {
      accessToken: 'access-2',
      expiresAt: 999_000,
      scope: [],
    })
    expect(refreshed).toMatchObject({
      expiresAt: 999_000,
      refreshTokenExpiresAt: 456_000,
      scope: ['boards:read', 'pins:read'],
      user: { username: 'creator' },
    })
    expect(await credentials.load('oauth:pinterest:refresh-token')).toBe(
      'refresh-1',
    )
  })

  it('disconnects the account without deleting app configuration', async () => {
    await savePinterestApp(storage, credentials, app)
    await savePinterestSession(storage, credentials, {
      token: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: 123_000,
        scope: ['boards:read'],
      },
      user: { id: 'u1', username: 'creator' },
    })

    await clearPinterestSession(storage, credentials)
    expect(await credentials.load('oauth:pinterest:access-token')).toBeNull()
    expect(await credentials.load('oauth:pinterest:refresh-token')).toBeNull()
    expect(await credentials.load('oauth:pinterest:client-secret')).toBe(
      'client-secret',
    )
    const connection = await loadPinterestConnection(storage, credentials)
    expect(connection).toMatchObject({
      clientId: 'app-id',
      redirectUri: app.redirectUri,
      hasClientSecret: true,
      hasAccessToken: false,
      hasRefreshToken: false,
    })
    expect(connection?.user).toBeUndefined()
  })

  it('forgets all Pinterest secrets and the non-sensitive connection row', async () => {
    await savePinterestApp(storage, credentials, app)
    await savePinterestSession(storage, credentials, {
      token: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: 123_000,
        scope: ['boards:read'],
      },
      user: { id: 'u1', username: 'creator' },
    })

    await clearPinterestConnection(storage, credentials)
    expect(await credentials.load('oauth:pinterest:client-secret')).toBeNull()
    expect(await credentials.load('oauth:pinterest:access-token')).toBeNull()
    expect(await credentials.load('oauth:pinterest:refresh-token')).toBeNull()
    expect(
      await storage.query('presets', { id: PINTEREST_CONNECTION_KEY }),
    ).toEqual([])
  })
})

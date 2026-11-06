import type { PinterestTokenSet, PinterestUser } from '../../domain/inspiration/pinterest'
import type { CredentialPort, StoragePort } from '../../platform/ports'

export const PINTEREST_CONNECTION_KEY = 'pinterest:oauth:connection:v1'
const CLIENT_SECRET_REF = 'oauth:pinterest:client-secret'
const ACCESS_TOKEN_REF = 'oauth:pinterest:access-token'
const REFRESH_TOKEN_REF = 'oauth:pinterest:refresh-token'

export interface PinterestConnection {
  clientId: string
  redirectUri: string
  hasClientSecret: boolean
  hasAccessToken: boolean
  hasRefreshToken: boolean
  expiresAt?: number
  refreshTokenExpiresAt?: number
  scope: string[]
  user?: PinterestUser
  updatedAt: number
}

export interface PinterestConnectionSecrets {
  clientSecret: string
  token?: PinterestTokenSet
}

export async function loadPinterestRuntimeSecrets(
  credentials: CredentialPort,
): Promise<{
  clientSecret: string
  accessToken: string
  refreshToken: string
}> {
  const [clientSecret, accessToken, refreshToken] = await Promise.all([
    credentials.load(CLIENT_SECRET_REF),
    credentials.load(ACCESS_TOKEN_REF),
    credentials.load(REFRESH_TOKEN_REF),
  ])
  return {
    clientSecret: clientSecret ?? '',
    accessToken: accessToken ?? '',
    refreshToken: refreshToken ?? '',
  }
}

export async function loadPinterestConnection(
  storage: StoragePort,
  credentials: CredentialPort,
): Promise<PinterestConnection | null> {
  const rows = await storage.query('presets', { id: PINTEREST_CONNECTION_KEY })
  const row = rows[0]
  if (!row) return null
  const [clientSecret, accessToken, refreshToken] = await Promise.all([
    credentials.load(CLIENT_SECRET_REF),
    credentials.load(ACCESS_TOKEN_REF),
    credentials.load(REFRESH_TOKEN_REF),
  ])
  const expiresAt = numberOrUndefined(row.expiresAt)
  const refreshTokenExpiresAt = numberOrUndefined(row.refreshTokenExpiresAt)
  const user = userOf(row.user)
  return {
    clientId: textOf(row.clientId),
    redirectUri: textOf(row.redirectUri),
    hasClientSecret: Boolean(clientSecret),
    hasAccessToken: Boolean(accessToken),
    hasRefreshToken: Boolean(refreshToken),
    ...(expiresAt ? { expiresAt } : {}),
    ...(refreshTokenExpiresAt ? { refreshTokenExpiresAt } : {}),
    scope: arrayOfText(row.scope),
    ...(user ? { user } : {}),
    updatedAt: numberOrUndefined(row.updatedAt) ?? 0,
  }
}

export async function loadPinterestSecrets(
  credentials: CredentialPort,
): Promise<PinterestConnectionSecrets | null> {
  const { clientSecret, accessToken, refreshToken } =
    await loadPinterestRuntimeSecrets(credentials)
  if (!clientSecret) return null
  return {
    clientSecret,
    ...(accessToken
      ? {
          token: {
            accessToken,
            ...(refreshToken ? { refreshToken } : {}),
            expiresAt: 0,
            scope: [],
          },
        }
      : {}),
  }
}

export async function savePinterestApp(
  storage: StoragePort,
  credentials: CredentialPort,
  input: {
    clientId: string
    clientSecret?: string
    redirectUri: string
  },
): Promise<PinterestConnection> {
  const current = await loadPinterestConnection(storage, credentials)
  const clientId = input.clientId.trim()
  const redirectUri = input.redirectUri.trim()
  if (!clientId || !redirectUri) throw new Error('Pinterest Client ID 和回调地址不能为空')
  const clientSecret = input.clientSecret?.trim()
  if (clientSecret) await credentials.save(CLIENT_SECRET_REF, clientSecret)
  const now = Date.now()
  await storage.put('presets', {
    id: PINTEREST_CONNECTION_KEY,
    clientId,
    redirectUri,
    scope: current?.scope ?? [],
    ...(current?.expiresAt ? { expiresAt: current.expiresAt } : {}),
    ...(current?.refreshTokenExpiresAt
      ? { refreshTokenExpiresAt: current.refreshTokenExpiresAt }
      : {}),
    ...(current?.user ? { user: current.user } : {}),
    updatedAt: now,
  })
  return (await loadPinterestConnection(storage, credentials))!
}

export async function savePinterestSession(
  storage: StoragePort,
  credentials: CredentialPort,
  input: {
    token: PinterestTokenSet
    user: PinterestUser
  },
): Promise<PinterestConnection> {
  const current = await loadPinterestConnection(storage, credentials)
  if (!current?.clientId || !current.redirectUri || !current.hasClientSecret) {
    throw new Error('请先保存 Pinterest OAuth 应用配置')
  }
  await credentials.save(ACCESS_TOKEN_REF, input.token.accessToken)
  if (input.token.refreshToken) {
    await credentials.save(REFRESH_TOKEN_REF, input.token.refreshToken)
  } else {
    await credentials.remove(REFRESH_TOKEN_REF)
  }
  await storage.put('presets', {
    id: PINTEREST_CONNECTION_KEY,
    clientId: current.clientId,
    redirectUri: current.redirectUri,
    expiresAt: input.token.expiresAt,
    ...(input.token.refreshTokenExpiresAt
      ? { refreshTokenExpiresAt: input.token.refreshTokenExpiresAt }
      : {}),
    scope: input.token.scope,
    user: input.user,
    updatedAt: Date.now(),
  })
  return (await loadPinterestConnection(storage, credentials))!
}

export async function savePinterestToken(
  storage: StoragePort,
  credentials: CredentialPort,
  token: PinterestTokenSet,
): Promise<PinterestConnection> {
  const current = await loadPinterestConnection(storage, credentials)
  if (!current) throw new Error('Pinterest OAuth 应用尚未配置')
  await credentials.save(ACCESS_TOKEN_REF, token.accessToken)
  if (token.refreshToken) {
    await credentials.save(REFRESH_TOKEN_REF, token.refreshToken)
  }
  await storage.put('presets', {
    id: PINTEREST_CONNECTION_KEY,
    clientId: current.clientId,
    redirectUri: current.redirectUri,
    expiresAt: token.expiresAt,
    ...(token.refreshTokenExpiresAt
      ? { refreshTokenExpiresAt: token.refreshTokenExpiresAt }
      : current.refreshTokenExpiresAt
        ? { refreshTokenExpiresAt: current.refreshTokenExpiresAt }
        : {}),
    scope: token.scope.length ? token.scope : current.scope,
    ...(current.user ? { user: current.user } : {}),
    updatedAt: Date.now(),
  })
  return (await loadPinterestConnection(storage, credentials))!
}

export async function clearPinterestSession(
  storage: StoragePort,
  credentials: CredentialPort,
): Promise<void> {
  await Promise.all([
    credentials.remove(ACCESS_TOKEN_REF),
    credentials.remove(REFRESH_TOKEN_REF),
  ])
  const current = await loadPinterestConnection(storage, credentials)
  if (!current) return
  await storage.put('presets', {
    id: PINTEREST_CONNECTION_KEY,
    clientId: current.clientId,
    redirectUri: current.redirectUri,
    scope: current.scope,
    updatedAt: Date.now(),
  })
}

export async function clearPinterestConnection(
  storage: StoragePort,
  credentials: CredentialPort,
): Promise<void> {
  await Promise.all([
    credentials.remove(CLIENT_SECRET_REF),
    credentials.remove(ACCESS_TOKEN_REF),
    credentials.remove(REFRESH_TOKEN_REF),
  ])
  await storage.delete('presets', PINTEREST_CONNECTION_KEY)
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : undefined
}

function arrayOfText(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(textOf).filter(Boolean))]
    : []
}

function userOf(value: unknown): PinterestUser | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const id = textOf(row.id)
  const username = textOf(row.username)
  if (!id || !username) return null
  return {
    id,
    username,
    ...(textOf(row.accountType) ? { accountType: textOf(row.accountType) } : {}),
    ...(textOf(row.profileImage) ? { profileImage: textOf(row.profileImage) } : {}),
  }
}

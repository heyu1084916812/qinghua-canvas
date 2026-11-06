import { pinterestTokenNeedsRefresh } from '../../../domain/inspiration/pinterest'
import type { PlatformKit } from '../../../platform/ports'
import {
  loadPinterestConnection,
  loadPinterestRuntimeSecrets,
  savePinterestToken,
  type PinterestConnection,
} from '../../../state/project/pinterestConnectionStore'
import {
  createPinterestApi,
  type PinterestApi,
} from './pinterestApi'

export interface PinterestSession {
  api: PinterestApi
  connection: PinterestConnection
  accessToken: string
}

export async function openPinterestSession(
  platform: Pick<PlatformKit, 'storage' | 'network' | 'credentials'>,
  signal: AbortSignal,
): Promise<PinterestSession> {
  const connection = await loadPinterestConnection(
    platform.storage,
    platform.credentials,
  )
  if (!connection?.clientId || !connection.redirectUri || !connection.hasClientSecret) {
    throw new Error('请先配置并保存 Pinterest OAuth 应用')
  }
  const { clientSecret, accessToken, refreshToken } =
    await loadPinterestRuntimeSecrets(platform.credentials)
  if (!clientSecret) throw new Error('Pinterest Client Secret 已丢失，请重新配置')
  const api = createPinterestApi(platform.network)
  if (
    accessToken &&
    connection.expiresAt &&
    !pinterestTokenNeedsRefresh({ expiresAt: connection.expiresAt })
  ) {
    return { api, connection, accessToken }
  }
  if (!refreshToken) {
    throw new Error('Pinterest 登录已过期，请重新授权')
  }
  const refreshed = await api.refreshToken(
    {
      clientId: connection.clientId,
      clientSecret,
      redirectUri: connection.redirectUri,
      refreshToken,
    },
    signal,
  )
  const next = await savePinterestToken(
    platform.storage,
    platform.credentials,
    refreshed,
  )
  return {
    api,
    connection: next,
    accessToken: refreshed.accessToken,
  }
}

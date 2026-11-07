import {
  normalizePinterestBoard,
  normalizePinterestPin,
  normalizePinterestToken,
  normalizePinterestUser,
  PINTEREST_API_BASE,
  type PinterestBoard,
  type PinterestPin,
  type PinterestTokenSet,
  type PinterestUser,
} from '../../../domain/inspiration/pinterest'
import type { NetworkPort } from '../../../platform/ports'
import { errorTextOf } from '../../../shared/result'
import {
  pinterestArrayOf,
  pinterestBasicAuth,
  pinterestJsonPayload,
  pinterestRecordOf,
  pinterestResponseError,
  pinterestTextOf,
} from './pinterestHttp'
import {
  PINTEREST_PAGE_SIZE,
  pinterestPagedResult,
  type PinterestPageResult,
} from './pinterestPaging'

const TOKEN_URL = `${PINTEREST_API_BASE}/oauth/token`
export type { PinterestPageResult }

export interface PinterestTokenCredentials {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export interface PinterestApi {
  exchangeCode(
    input: PinterestTokenCredentials & { code: string },
    signal: AbortSignal,
  ): Promise<PinterestTokenSet>
  refreshToken(
    input: PinterestTokenCredentials & { refreshToken: string },
    signal: AbortSignal,
  ): Promise<PinterestTokenSet>
  user(accessToken: string, signal: AbortSignal): Promise<PinterestUser>
  boards(accessToken: string, signal: AbortSignal): Promise<PinterestBoard[]>
  boardsDetailed(
    accessToken: string,
    signal: AbortSignal,
  ): Promise<PinterestPageResult<PinterestBoard>>
  pins(
    accessToken: string,
    boardId: string,
    signal: AbortSignal,
  ): Promise<PinterestPin[]>
  pinsDetailed(
    accessToken: string,
    boardId: string,
    signal: AbortSignal,
  ): Promise<PinterestPageResult<PinterestPin>>
}

export function createPinterestApi(network: NetworkPort): PinterestApi {
  const tokenRequest = async (
    credentials: PinterestTokenCredentials,
    body: URLSearchParams,
    signal: AbortSignal,
  ): Promise<PinterestTokenSet> => {
    const response = await network.request(
      {
        url: TOKEN_URL,
        method: 'POST',
        headers: {
          Authorization: `Basic ${pinterestBasicAuth(credentials.clientId, credentials.clientSecret)}`,
          Accept: 'application/json',
        },
        body,
        publicOnly: true,
        maxResponseBytes: 1024 * 1024,
        timeoutMs: 30_000,
      },
      signal,
    )
    const payload = await pinterestJsonPayload(response.status, response.text)
    if (response.status < 200 || response.status >= 300) {
      throw new Error(pinterestResponseError(payload, `Pinterest OAuth HTTP ${response.status}`))
    }
    return normalizePinterestToken(payload as never)
  }

  const getJson = async (
    url: string,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<unknown> => {
    const response = await network.request(
      {
        url,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        publicOnly: true,
        maxResponseBytes: 8 * 1024 * 1024,
        timeoutMs: 30_000,
      },
      signal,
    )
    const payload = await pinterestJsonPayload(response.status, response.text)
    if (response.status < 200 || response.status >= 300) {
      throw new Error(pinterestResponseError(payload, `Pinterest API HTTP ${response.status}`))
    }
    return payload
  }

  const pageJson = async (
    base: string,
    bookmark: string,
    accessToken: string,
    signal: AbortSignal,
  ) => {
    const url = new URL(base)
    url.searchParams.set('page_size', String(PINTEREST_PAGE_SIZE))
    if (bookmark) url.searchParams.set('bookmark', bookmark)
    const payload = pinterestRecordOf(await getJson(url.toString(), accessToken, signal))
    return {
      items: pinterestArrayOf(payload.items),
      bookmark: pinterestTextOf(payload.bookmark),
    }
  }

  const boardsPage = (accessToken: string, signal: AbortSignal) =>
    pinterestPagedResult(
      (bookmark) => {
        return pageJson(`${PINTEREST_API_BASE}/boards`, bookmark, accessToken, signal)
      },
      normalizePinterestBoard,
      (item) => item.id,
    ).then((result) => ({
      ...result,
      items: result.items.sort((left, right) =>
        left.name.localeCompare(right.name, 'zh-CN'),
      ),
    }))

  const pinsPage = (accessToken: string, boardId: string, signal: AbortSignal) =>
    pinterestPagedResult(
      (bookmark) => {
        return pageJson(`${PINTEREST_API_BASE}/boards/${encodeURIComponent(boardId)}/pins`, bookmark, accessToken, signal)
      },
      normalizePinterestPin,
      (item) => item.id,
    )

  return {
    exchangeCode(input, signal) {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
      })
      return tokenRequest(input, body, signal)
    },

    refreshToken(input, signal) {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
      })
      return tokenRequest(input, body, signal)
    },

    async user(accessToken, signal) {
      return normalizePinterestUser(
        await getJson(`${PINTEREST_API_BASE}/user_account`, accessToken, signal),
      )
    },

    async boards(accessToken, signal) {
      return (await boardsPage(accessToken, signal)).items
    },

    boardsDetailed(accessToken, signal) {
      return boardsPage(accessToken, signal)
    },

    async pins(accessToken, boardId, signal) {
      return (await pinsPage(accessToken, boardId, signal)).items
    },

    pinsDetailed(accessToken, boardId, signal) {
      return pinsPage(accessToken, boardId, signal)
    },
  }
}

export function pinterestRequestError(error: unknown): string {
  return errorTextOf(error)
}

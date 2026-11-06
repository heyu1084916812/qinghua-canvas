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
import { bytesToBase64 } from '../../../domain/shared/base64'
import type { NetworkPort } from '../../../platform/ports'
import { errorTextOf } from '../../../shared/result'

const TOKEN_URL = `${PINTEREST_API_BASE}/oauth/token`
const PAGE_SIZE = 100
const MAX_PAGES = 20

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
  pins(
    accessToken: string,
    boardId: string,
    signal: AbortSignal,
  ): Promise<PinterestPin[]>
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
          Authorization: `Basic ${basicAuth(credentials.clientId, credentials.clientSecret)}`,
          Accept: 'application/json',
        },
        body,
        publicOnly: true,
        maxResponseBytes: 1024 * 1024,
        timeoutMs: 30_000,
      },
      signal,
    )
    const payload = await jsonPayload(response.status, response.text)
    if (response.status < 200 || response.status >= 300) {
      throw new Error(pinterestError(payload, `Pinterest OAuth HTTP ${response.status}`))
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
    const payload = await jsonPayload(response.status, response.text)
    if (response.status < 200 || response.status >= 300) {
      throw new Error(pinterestError(payload, `Pinterest API HTTP ${response.status}`))
    }
    return payload
  }

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
      const items: PinterestBoard[] = []
      const seen = new Set<string>()
      let bookmark = ''
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const url = new URL(`${PINTEREST_API_BASE}/boards`)
        url.searchParams.set('page_size', String(PAGE_SIZE))
        if (bookmark) url.searchParams.set('bookmark', bookmark)
        const payload = recordOf(await getJson(url.toString(), accessToken, signal))
        for (const raw of arrayOf(payload.items)) {
          const item = normalizePinterestBoard(raw)
          if (!item || seen.has(item.id)) continue
          seen.add(item.id)
          items.push(item)
        }
        bookmark = textOf(payload.bookmark)
        if (!bookmark) break
      }
      return items.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    },

    async pins(accessToken, boardId, signal) {
      const items: PinterestPin[] = []
      const seen = new Set<string>()
      let bookmark = ''
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const url = new URL(
          `${PINTEREST_API_BASE}/boards/${encodeURIComponent(boardId)}/pins`,
        )
        url.searchParams.set('page_size', String(PAGE_SIZE))
        if (bookmark) url.searchParams.set('bookmark', bookmark)
        const payload = recordOf(await getJson(url.toString(), accessToken, signal))
        for (const raw of arrayOf(payload.items)) {
          const item = normalizePinterestPin(raw)
          if (!item || seen.has(item.id)) continue
          seen.add(item.id)
          items.push(item)
        }
        bookmark = textOf(payload.bookmark)
        if (!bookmark) break
      }
      return items
    },
  }
}

function basicAuth(clientId: string, clientSecret: string): string {
  return bytesToBase64(new TextEncoder().encode(`${clientId}:${clientSecret}`))
}

async function jsonPayload(
  status: number,
  text: () => Promise<string>,
): Promise<unknown> {
  const raw = await text().catch(() => '')
  if (!raw.trim()) {
    if (status >= 200 && status < 300) {
      throw new Error('Pinterest 返回了空响应')
    }
    return {}
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    if (status >= 200 && status < 300) {
      throw new Error(`Pinterest 返回了无法解析的响应：${raw.slice(0, 200)}`)
    }
    return { message: raw.slice(0, 500) }
  }
}

function pinterestError(payload: unknown, fallback: string): string {
  const value = recordOf(payload)
  const detail = textOf(value.message) || textOf(value.error_description) || textOf(value.error)
  return detail ? `${fallback}: ${detail}` : fallback
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function pinterestRequestError(error: unknown): string {
  return errorTextOf(error)
}

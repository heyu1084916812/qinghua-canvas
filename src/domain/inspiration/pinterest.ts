import type { DesignResearchItem } from './designResearch'

export const PINTEREST_API_BASE = 'https://api.pinterest.com/v5'
export const PINTEREST_OAUTH_URL = 'https://www.pinterest.com/oauth/'
export const PINTEREST_SCOPES = [
  'boards:read',
  'pins:read',
  'user_accounts:read',
] as const

export interface PinterestTokenSet {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  refreshTokenExpiresAt?: number
  scope: string[]
}

export interface PinterestUser {
  id: string
  username: string
  accountType?: string
  profileImage?: string
}

export interface PinterestBoard {
  id: string
  name: string
  description?: string
  pinCount?: number
  privacy?: string
}

export interface PinterestPin {
  id: string
  boardId: string
  title: string
  description?: string
  link?: string
  imageUrl?: string
  createdAt?: number
}

export interface PinterestBoardPage {
  items: PinterestBoard[]
  bookmark?: string
}

export interface PinterestPinPage {
  items: PinterestPin[]
  bookmark?: string
}

export interface PinterestTokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  refresh_token_expires_in?: unknown
  scope?: unknown
}

export function pinterestOAuthUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  scopes?: readonly string[]
}): string {
  const url = new URL(PINTEREST_OAUTH_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId.trim())
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('scope', (input.scopes ?? PINTEREST_SCOPES).join(','))
  url.searchParams.set('state', input.state)
  return url.toString()
}

export function normalizePinterestToken(
  raw: PinterestTokenResponse,
  now = Date.now(),
): PinterestTokenSet {
  const accessToken = textOf(raw.access_token)
  if (!accessToken) throw new Error('Pinterest 没有返回 access token')
  const expiresIn = secondsOf(raw.expires_in)
  const refreshExpiresIn = secondsOf(raw.refresh_token_expires_in)
  const refreshToken = textOf(raw.refresh_token)
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    expiresAt: now + Math.max(60, expiresIn ?? 3600) * 1000,
    ...(refreshExpiresIn
      ? { refreshTokenExpiresAt: now + refreshExpiresIn * 1000 }
      : {}),
    scope: scopesOf(raw.scope),
  }
}

export function pinterestTokenNeedsRefresh(
  token: Pick<PinterestTokenSet, 'expiresAt'>,
  now = Date.now(),
  skewMs = 120_000,
): boolean {
  return token.expiresAt <= now + skewMs
}

export function normalizePinterestUser(raw: unknown): PinterestUser {
  const value = objectOf(raw)
  const id = textOf(value.id)
  const username = textOf(value.username)
  if (!id || !username) throw new Error('Pinterest 用户信息不完整')
  return {
    id,
    username,
    ...(textOf(value.account_type)
      ? { accountType: textOf(value.account_type) }
      : {}),
    ...(textOf(value.profile_image)
      ? { profileImage: textOf(value.profile_image) }
      : {}),
  }
}

export function normalizePinterestBoard(raw: unknown): PinterestBoard | null {
  const value = objectOf(raw)
  const id = textOf(value.id)
  const name = textOf(value.name)
  if (!id || !name) return null
  const pinCount = numberOf(value.pin_count)
  return {
    id,
    name,
    ...(textOf(value.description)
      ? { description: textOf(value.description) }
      : {}),
    ...(pinCount !== undefined ? { pinCount } : {}),
    ...(textOf(value.privacy) ? { privacy: textOf(value.privacy) } : {}),
  }
}

export function normalizePinterestPin(raw: unknown): PinterestPin | null {
  const value = objectOf(raw)
  const id = textOf(value.id)
  const boardId = textOf(value.board_id)
  if (!id || !boardId) return null
  const media = objectOf(value.media)
  const images = objectOf(media.images)
  const imageUrl = [
    objectOf(images['1200x']).url,
    objectOf(images['600x']).url,
    objectOf(images.originals).url,
  ]
    .map(textOf)
    .find(Boolean)
  const createdAt = Date.parse(textOf(value.created_at))
  return {
    id,
    boardId,
    title: textOf(value.title) || textOf(value.description) || `Pinterest ${id}`,
    ...(textOf(value.description)
      ? { description: textOf(value.description) }
      : {}),
    ...(textOf(value.link) ? { link: textOf(value.link) } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(Number.isFinite(createdAt) ? { createdAt } : {}),
  }
}

export function pinterestPinToResearchItem(
  pin: PinterestPin,
  board: PinterestBoard,
): DesignResearchItem | null {
  if (!pin.imageUrl) return null
  return {
    id: `pinterest:${pin.id}`,
    source: 'pinterest',
    title: pin.title === `Pinterest ${pin.id}` ? board.name : pin.title,
    url: `https://www.pinterest.com/pin/${encodeURIComponent(pin.id)}/`,
    imageUrl: pin.imageUrl,
  }
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : undefined
}

function secondsOf(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined
  }
  return Math.trunc(value)
}

function scopesOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map(textOf).filter(Boolean))]
  }
  return textOf(value)
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

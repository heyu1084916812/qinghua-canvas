import { describe, expect, it } from 'vitest'
import {
  normalizePinterestBoard,
  normalizePinterestPin,
  normalizePinterestToken,
  normalizePinterestUser,
  pinterestOAuthUrl,
  pinterestPinToResearchItem,
  pinterestTokenNeedsRefresh,
} from './pinterest'

describe('Pinterest OAuth and API projections', () => {
  it('builds an authorization URL with explicit scopes and state', () => {
    const url = new URL(
      pinterestOAuthUrl({
        clientId: 'app-id',
        redirectUri: 'http://127.0.0.1:53682/pinterest/callback',
        state: 'state-123',
      }),
    )
    expect(url.hostname).toBe('www.pinterest.com')
    expect(url.searchParams.get('scope')).toBe(
      'boards:read,pins:read,user_accounts:read',
    )
    expect(url.searchParams.get('state')).toBe('state-123')
  })

  it('normalizes expiring tokens and detects refresh skew', () => {
    const token = normalizePinterestToken(
      {
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 3600,
        refresh_token_expires_in: 86400,
        scope: 'boards:read pins:read',
      },
      1_000,
    )
    expect(token).toMatchObject({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 3_601_000,
      refreshTokenExpiresAt: 86_401_000,
      scope: ['boards:read', 'pins:read'],
    })
    expect(pinterestTokenNeedsRefresh(token, 3_500_000)).toBe(true)
    expect(pinterestTokenNeedsRefresh(token, 3_400_000)).toBe(false)
  })

  it('normalizes the user, boards and image-backed pins', () => {
    expect(
      normalizePinterestUser({
        id: 'u1',
        username: 'creator',
        account_type: 'PERSONAL',
      }),
    ).toMatchObject({ id: 'u1', username: 'creator' })
    const board = normalizePinterestBoard({
      id: 'b1',
      name: 'Moodboard',
      pin_count: 9,
      privacy: 'PUBLIC',
    })
    expect(board).toMatchObject({ id: 'b1', name: 'Moodboard', pinCount: 9 })
    const pin = normalizePinterestPin({
      id: 'p1',
      board_id: 'b1',
      title: 'Warm kitchen',
      description: 'Stone and oak',
      link: 'https://example.com',
      created_at: '2026-01-01T00:00:00Z',
      media: {
        images: {
          '600x': { url: 'https://i.pinimg.com/600x/p1.jpg' },
          '1200x': { url: 'https://i.pinimg.com/1200x/p1.jpg' },
        },
      },
    })
    expect(pin).toMatchObject({
      id: 'p1',
      title: 'Warm kitchen',
      imageUrl: 'https://i.pinimg.com/1200x/p1.jpg',
    })
    expect(pinterestPinToResearchItem(pin!, board!)).toMatchObject({
      id: 'pinterest:p1',
      imageUrl: 'https://i.pinimg.com/1200x/p1.jpg',
    })
  })

  it('drops malformed rows and pins without an image', () => {
    expect(normalizePinterestBoard({ id: '', name: 'x' })).toBeNull()
    expect(normalizePinterestPin({ id: 'p', board_id: '' })).toBeNull()
    expect(
      pinterestPinToResearchItem(
        { id: 'p', boardId: 'b', title: 'No image' },
        { id: 'b', name: 'Board' },
      ),
    ).toBeNull()
  })
})

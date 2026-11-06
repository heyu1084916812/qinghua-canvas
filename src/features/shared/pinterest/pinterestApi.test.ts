import { describe, expect, it, vi } from 'vitest'
import type {
  NetworkPort,
  NetworkRequest,
  NetworkResponse,
} from '../../../platform/ports'
import { createPinterestApi } from './pinterestApi'

function jsonResponse(payload: unknown, status = 200): NetworkResponse {
  const text = JSON.stringify(payload)
  return {
    status,
    headers: { 'content-type': 'application/json' },
    text: async () => text,
    json: async <T,>() => payload as T,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  }
}

function networkWith(responses: NetworkResponse[]): {
  network: NetworkPort
  requests: NetworkRequest[]
} {
  const requests: NetworkRequest[] = []
  const request = vi.fn<NetworkPort['request']>(async (input) => {
    requests.push(input)
    const response = responses.shift()
    if (!response) throw new Error('unexpected Pinterest request')
    return response
  })
  return {
    network: {
      request,
      async *stream() {},
    },
    requests,
  }
}

describe('Pinterest API', () => {
  it('exchanges and refreshes tokens with Basic auth and form bodies', async () => {
    const { network, requests } = networkWith([
      jsonResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        scope: 'boards:read,pins:read',
      }),
      jsonResponse({
        access_token: 'access-2',
        expires_in: 3600,
        scope: 'boards:read,pins:read',
      }),
    ])
    const api = createPinterestApi(network)
    const signal = new AbortController().signal
    const credentials = {
      clientId: 'app-id',
      clientSecret: 'secret',
      redirectUri: 'http://127.0.0.1:53682/pinterest/callback',
    }

    const first = await api.exchangeCode(
      { ...credentials, code: 'code-1' },
      signal,
    )
    const second = await api.refreshToken(
      { ...credentials, refreshToken: first.refreshToken! },
      signal,
    )

    expect(first).toMatchObject({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      scope: ['boards:read', 'pins:read'],
    })
    expect(second.accessToken).toBe('access-2')
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.pinterest.com/v5/oauth/token',
      publicOnly: true,
      headers: {
        Authorization: 'Basic YXBwLWlkOnNlY3JldA==',
      },
    })
    expect(requests[0]?.body).toBeInstanceOf(URLSearchParams)
    expect((requests[0]!.body as URLSearchParams).toString()).toBe(
      'grant_type=authorization_code&code=code-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A53682%2Fpinterest%2Fcallback',
    )
    expect((requests[1]!.body as URLSearchParams).get('grant_type')).toBe(
      'refresh_token',
    )
    expect((requests[1]!.body as URLSearchParams).get('refresh_token')).toBe(
      'refresh-1',
    )
  })

  it('reads the authenticated user, paginated boards and paginated pins', async () => {
    const { network, requests } = networkWith([
      jsonResponse({
        id: 'u1',
        username: 'creator',
        account_type: 'PERSONAL',
      }),
      jsonResponse({
        items: [
          { id: 'b2', name: 'Kitchen', pin_count: 2 },
          { id: 'b1', name: 'Brand', pin_count: 1 },
        ],
        bookmark: 'boards-next',
      }),
      jsonResponse({
        items: [{ id: 'b3', name: 'Travel', pin_count: 0 }],
      }),
      jsonResponse({
        items: [
          {
            id: 'p1',
            board_id: 'b1',
            title: 'Warm oak',
            media: {
              images: {
                '600x': { url: 'https://i.pinimg.com/600x/p1.jpg' },
              },
            },
          },
        ],
        bookmark: 'pins-next',
      }),
      jsonResponse({
        items: [
          {
            id: 'p2',
            board_id: 'b1',
            description: 'Stone counter',
            media: {
              images: {
                originals: { url: 'https://i.pinimg.com/originals/p2.jpg' },
              },
            },
          },
        ],
      }),
    ])
    const api = createPinterestApi(network)
    const signal = new AbortController().signal

    const user = await api.user('access', signal)
    const boards = await api.boards('access', signal)
    const pins = await api.pins('access', 'b1', signal)

    expect(user).toMatchObject({ id: 'u1', username: 'creator' })
    expect(boards.map((board) => board.id)).toEqual(['b1', 'b2', 'b3'])
    expect(pins).toMatchObject([
      { id: 'p1', imageUrl: 'https://i.pinimg.com/600x/p1.jpg' },
      { id: 'p2', imageUrl: 'https://i.pinimg.com/originals/p2.jpg' },
    ])
    expect(requests[1]?.headers).toMatchObject({ Authorization: 'Bearer access' })
    expect(requests[2]?.url).toContain('bookmark=boards-next')
    expect(requests[3]?.url).toBe(
      'https://api.pinterest.com/v5/boards/b1/pins?page_size=100',
    )
    expect(requests[4]?.url).toContain('bookmark=pins-next')
  })

  it('surfaces provider errors without returning malformed rows', async () => {
    const { network } = networkWith([
      jsonResponse({ message: 'scope is not approved' }, 403),
    ])
    const api = createPinterestApi(network)
    await expect(
      api.user('access', new AbortController().signal),
    ).rejects.toThrow('Pinterest API HTTP 403: scope is not approved')
  })
})

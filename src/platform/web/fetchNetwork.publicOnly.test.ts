import { describe, expect, it, vi } from 'vitest'
import { createFetchNetwork } from './fetchNetwork'

describe('createFetchNetwork publicOnly', () => {
  it('rejects private URLs before any transport runs', async () => {
    const request = vi.fn()
    const network = createFetchNetwork({ request })

    await expect(
      network.request(
        {
          url: 'http://127.0.0.1:18765/state',
          publicOnly: true,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      kind: 'network',
      detail: 'blocked',
      sendPhase: 'not-sent',
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('forces designated public requests through the desktop validator', async () => {
    const request = vi.fn(async () => ({
      status: 200,
      headers: { 'content-type': 'text/html' },
      text: '<html>ok</html>',
    }))
    const network = createFetchNetwork({ request })
    const response = await network.request(
      {
        url: 'https://example.com/project',
        publicOnly: true,
      },
      new AbortController().signal,
    )

    expect(await response.text()).toBe('<html>ok</html>')
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/project',
        publicOnly: true,
      }),
      expect.any(AbortSignal),
    )
  })

  it('fails closed when a public request has no desktop validator', async () => {
    const network = createFetchNetwork()

    await expect(
      network.request(
        {
          url: 'https://example.com/project',
          publicOnly: true,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      kind: 'network',
      detail: 'blocked',
      sendPhase: 'not-sent',
    })
  })
})

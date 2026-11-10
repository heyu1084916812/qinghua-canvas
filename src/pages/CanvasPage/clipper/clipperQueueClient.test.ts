import { describe, expect, it, vi } from 'vitest'
import { readClipperPendingQueue } from './clipperQueueClient'

describe('clipper pending queue client', () => {
  it('falls back to take_pending when the desktop shell predates snapshots', async () => {
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === 'clipper_pending_snapshot') {
        throw new Error('Command clipper_pending_snapshot not found')
      }
      return [{
        id: 'legacy-clip',
        url: 'https://example.com/image',
        receivedAt: 1,
      }]
    })

    await expect(readClipperPendingQueue(invokeCommand)).resolves.toMatchObject({
      legacy: true,
      clips: [expect.objectContaining({ id: 'legacy-clip' })],
    })
    expect(invokeCommand.mock.calls.map(([command]) => command)).toEqual([
      'clipper_pending_snapshot',
      'clipper_take_pending',
    ])
  })

  it('does not hide unrelated backend errors', async () => {
    const invokeCommand = vi.fn(async () => {
      throw new Error('permission denied')
    })
    await expect(readClipperPendingQueue(invokeCommand)).rejects.toThrow('permission denied')
  })
})

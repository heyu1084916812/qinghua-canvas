import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { ConversationResearchItem } from './conversation'
import { useResearchGalleryActions } from './useResearchGalleryActions'

const item = (id: string): ConversationResearchItem => ({
  id,
  title: id,
  url: `https://www.behance.net/${id}`,
  imageUrl: `https://img.example.com/${id}.jpg`,
  source: 'bing',
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('useResearchGalleryActions (B6: busy race after abort)', () => {
  it('a stale action settling after abort does not clear the new action busy state or status', async () => {
    let actions!: ReturnType<typeof useResearchGalleryActions>
    function Harness() {
      actions = useResearchGalleryActions()
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Harness))
    })
    const first = deferred<{ ok: boolean; message: string }>()
    const second = deferred<{ ok: boolean; message: string }>()
    const firstSettled = vi.fn()
    let firstRun!: Promise<void>
    let secondRun!: Promise<void>
    act(() => {
      firstRun = actions.run(item('a'), 'download', () => first.promise, undefined, firstSettled)
    })
    expect(actions.busy).toEqual({ id: 'a', action: 'download' })
    act(() => {
      expect(actions.abort()).toBe(true)
    })
    act(() => {
      secondRun = actions.run(item('b'), 'send', () => second.promise)
    })
    expect(actions.busy).toEqual({ id: 'b', action: 'send' })
    // 旧动作晚到：不得清掉新动作的 busy，也不得覆盖文案。
    await act(async () => {
      first.resolve({ ok: true, message: '旧动作完成' })
      await firstRun
    })
    expect(actions.busy).toEqual({ id: 'b', action: 'send' })
    expect(actions.status).toBe('')
    expect(firstSettled).not.toHaveBeenCalled()
    // 第二次点击仍被挡住（busy 还在）。
    const blocked = vi.fn(async () => ({ ok: true, message: 'x' }))
    await act(async () => {
      await actions.run(item('c'), 'send', blocked)
    })
    expect(blocked).not.toHaveBeenCalled()
    await act(async () => {
      second.resolve({ ok: true, message: '新动作完成' })
      await secondRun
    })
    expect(actions.busy).toBeNull()
    expect(actions.status).toBe('新动作完成')
  })
})

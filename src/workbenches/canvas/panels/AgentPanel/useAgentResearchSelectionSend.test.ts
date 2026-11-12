import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { researchSelectionActions, researchSelectionStore } from './researchSelection'
import { useAgentResearchSelectionSend } from './useAgentResearchSelectionSend'

const img = { id: 'bing:0', title: '咖啡海报', url: 'https://www.behance.net/a', imageUrl: 'https://img.example.com/a.png', source: 'bing' }
const img2 = { ...img, id: 'bing:1', imageUrl: 'https://img.example.com/b.png' }

function mount(draft: string, commit: ReturnType<typeof vi.fn>) {
  const dispatchText = vi.fn()
  const pending: Promise<unknown>[] = []
  let send!: ReturnType<typeof useAgentResearchSelectionSend>
  function Harness() {
    send = useAgentResearchSelectionSend({
      sessionId: 's1',
      draft,
      deliveryMode: 'queue',
      commitResearchSelection: commit as never,
      dispatchText,
      runPromiseDetached: (promise) => { pending.push(promise) },
    })
    return null
  }
  act(() => { TestRenderer.create(createElement(Harness)) })
  return { send: () => send(), dispatchText, pending }
}

describe('useAgentResearchSelectionSend (G-R2 / G-R4)', () => {
  afterEach(() => researchSelectionStore.reset())

  it('without a selection sends the draft as before and never touches the ledger', () => {
    const commit = vi.fn()
    const { send, dispatchText } = mount('你好', commit)
    send()
    expect(commit).not.toHaveBeenCalled()
    expect(dispatchText).toHaveBeenCalledWith('你好', 'queue')
  })

  it('commits staged images first, appends reference mentions, marks them sent', async () => {
    researchSelectionActions('s1').toggle(img)
    researchSelectionActions('s1').toggle(img2)
    const commit = vi.fn(async () => ({
      committed: [{ candidate: img, reference: { id: 'r1' } }],
      failed: [{ candidate: img2, message: 'HTTP 403' }],
      mentions: ['@[咖啡海报](reference:r1)'],
    }))
    const { send, dispatchText, pending } = mount('好的', commit)
    send()
    send() // 存台账期间重复点击不重复提交
    await act(async () => { await Promise.all(pending) })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith([img, img2])
    expect(dispatchText).toHaveBeenCalledTimes(1)
    expect(dispatchText).toHaveBeenCalledWith('好的 @[咖啡海报](reference:r1)', 'queue')
    const state = researchSelectionStore.get('s1')
    expect(state.sentKeys.has(img.imageUrl)).toBe(true)
    // 没存进去的那张留在输入框，用户可以重试或移除
    expect(state.selected.map((row) => row.id)).toEqual(['bing:1'])
  })

  it('images only (empty draft) still sends with a default line', async () => {
    researchSelectionActions('s1').toggle(img)
    const commit = vi.fn(async () => ({
      committed: [{ candidate: img, reference: { id: 'r1' } }], failed: [], mentions: ['@[咖啡海报](reference:r1)'],
    }))
    const { send, dispatchText, pending } = mount('', commit)
    send()
    await act(async () => { await Promise.all(pending) })
    expect(dispatchText).toHaveBeenCalledWith('参考这些图片 @[咖啡海报](reference:r1)', 'queue')
  })
})

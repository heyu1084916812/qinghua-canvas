import { afterEach, describe, expect, it } from 'vitest'
import {
  composeResearchSelectionText,
  markResearchSelectionSent,
  researchSelectionActions,
  researchSelectionKey,
  researchSelectionStore,
  toggleResearchSelection,
} from './researchSelection'

const a = { id: 'bing:0', title: 'A', url: 'https://www.behance.net/a', imageUrl: 'https://img.example.com/a.png', source: 'bing' }
const b = { id: 'bing:1', title: 'B', url: 'https://www.behance.net/b', imageUrl: 'https://img.example.com/b.png', source: 'bing' }

describe('researchSelection (G-R2)', () => {
  afterEach(() => researchSelectionStore.reset())

  it('toggles multi-select in click order and dedupes by original image url', () => {
    let state = researchSelectionStore.get('s')
    state = toggleResearchSelection(state, a)
    state = toggleResearchSelection(state, b)
    expect(state.selected.map((row) => row.id)).toEqual(['bing:0', 'bing:1'])
    // 另一次调研里同一张原图（不同候选 id）= 同一张
    state = toggleResearchSelection(state, { ...a, id: 'bing:9' })
    expect(state.selected.map((row) => row.id)).toEqual(['bing:1'])
  })

  it('buckets per session and marks sent images, clearing them from the selection', () => {
    researchSelectionActions('s1').toggle(a)
    researchSelectionActions('s1').toggle(b)
    researchSelectionActions('s2').toggle(b)
    researchSelectionActions('s1').markSent([a])
    expect(researchSelectionStore.get('s1').selected.map((row) => row.id)).toEqual(['bing:1'])
    expect(researchSelectionStore.get('s1').sentKeys.has(researchSelectionKey(a))).toBe(true)
    expect(researchSelectionStore.get('s2').sentKeys.size).toBe(0)
    researchSelectionActions('s1').stage(a)
    researchSelectionActions('s1').stage(a)
    expect(researchSelectionStore.get('s1').selected.map((row) => row.id)).toEqual(['bing:1', 'bing:0'])
    researchSelectionActions('s1').remove(researchSelectionKey(b))
    expect(researchSelectionStore.get('s1').selected.map((row) => row.id)).toEqual(['bing:0'])
  })

  it('markSent is a pure transition', () => {
    const before = toggleResearchSelection(researchSelectionStore.get('x'), a)
    const after = markResearchSelectionSent(before, [a])
    expect(before.selected).toHaveLength(1)
    expect(after.selected).toHaveLength(0)
  })

  it('composes the message: user text + reference mentions; empty text gets a default', () => {
    expect(composeResearchSelectionText('好的', ['@[A](reference:r1)'])).toBe('好的 @[A](reference:r1)')
    expect(composeResearchSelectionText('  ', ['@[A](reference:r1)'])).toBe('参考这些图片 @[A](reference:r1)')
    expect(composeResearchSelectionText('只有文字', [])).toBe('只有文字')
  })
})

import { useSyncExternalStore } from 'react'
import type { ConversationResearchItem } from './conversation'

/**
 * G-R2：调研图片浮层的「勾选」状态，按会话分桶。
 *
 * 勾选 ≠ 加入参考：勾选只把图挂到输入框（可取消），**发送时**才进参考台账并分析（G-R4）。
 * 发送过的图记进 sent：浮层里不再显示勾选框，悬停改为「发送至对话 / 添加到参考」。
 *
 * 放在模块级而不是 React state：浮层（对话区）与输入框（输入区）是两棵兄弟子树，
 * 中间隔着 AgentPanelView 的 props 拼装；一个按会话分桶的小 store 让两边读同一份，
 * 不必把勾选穿过整条 view-props 链。只在内存里：重开应用后勾选与「已发送」标记都不保留。
 */
export interface ResearchSelectionState {
  selected: readonly ConversationResearchItem[]
  sentKeys: ReadonlySet<string>
}

const EMPTY: ResearchSelectionState = { selected: [], sentKeys: new Set() }

/** 同一张原图跨多次调研结果算同一张：按原图地址去重，没有地址时退回候选 id。 */
export function researchSelectionKey(item: Pick<ConversationResearchItem, 'id' | 'imageUrl'>): string {
  return item.imageUrl.trim() || `id:${item.id}`
}

export function toggleResearchSelection(
  state: ResearchSelectionState,
  item: ConversationResearchItem,
): ResearchSelectionState {
  const key = researchSelectionKey(item)
  const has = state.selected.some((row) => researchSelectionKey(row) === key)
  return {
    ...state,
    selected: has
      ? state.selected.filter((row) => researchSelectionKey(row) !== key)
      : [...state.selected, item],
  }
}

/** 「发送至对话」：已发送过的图再挂一次（已挂着就不重复）。 */
export function stageResearchSelection(
  state: ResearchSelectionState,
  item: ConversationResearchItem,
): ResearchSelectionState {
  const key = researchSelectionKey(item)
  if (state.selected.some((row) => researchSelectionKey(row) === key)) return state
  return { ...state, selected: [...state.selected, item] }
}

export function removeResearchSelection(
  state: ResearchSelectionState,
  key: string,
): ResearchSelectionState {
  return { ...state, selected: state.selected.filter((row) => researchSelectionKey(row) !== key) }
}

/** 发送成功：清空勾选，把这些图记为已发送。 */
export function markResearchSelectionSent(
  state: ResearchSelectionState,
  sent: readonly ConversationResearchItem[],
): ResearchSelectionState {
  const sentKeys = new Set(state.sentKeys)
  for (const item of sent) sentKeys.add(researchSelectionKey(item))
  const done = new Set(sent.map(researchSelectionKey))
  return { selected: state.selected.filter((row) => !done.has(researchSelectionKey(row))), sentKeys }
}

const buckets = new Map<string, ResearchSelectionState>()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export const researchSelectionStore = {
  get(sessionId: string): ResearchSelectionState {
    return buckets.get(sessionId) ?? EMPTY
  },
  update(sessionId: string, next: (state: ResearchSelectionState) => ResearchSelectionState) {
    const before = researchSelectionStore.get(sessionId)
    const after = next(before)
    if (after === before) return
    buckets.set(sessionId, after)
    emit()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  /** 测试用。 */
  reset() {
    buckets.clear()
    emit()
  },
}

export function researchSelectionActions(sessionId: string) {
  return {
    toggle: (item: ConversationResearchItem) =>
      researchSelectionStore.update(sessionId, (s) => toggleResearchSelection(s, item)),
    stage: (item: ConversationResearchItem) =>
      researchSelectionStore.update(sessionId, (s) => stageResearchSelection(s, item)),
    remove: (key: string) =>
      researchSelectionStore.update(sessionId, (s) => removeResearchSelection(s, key)),
    markSent: (items: readonly ConversationResearchItem[]) =>
      researchSelectionStore.update(sessionId, (s) => markResearchSelectionSent(s, items)),
  }
}

export function useResearchSelection(sessionId: string): ResearchSelectionState {
  return useSyncExternalStore(
    researchSelectionStore.subscribe,
    () => researchSelectionStore.get(sessionId),
    () => researchSelectionStore.get(sessionId),
  )
}

/**
 * 带勾选图片发送时的消息正文：用户原话 + 末尾的参考引用。
 * 只勾了图没写字也能发（Lovart 实测哪怕只说「好的」也会先分析参考）。
 */
export const RESEARCH_SELECTION_DEFAULT_TEXT = '参考这些图片'

export function composeResearchSelectionText(draft: string, mentions: readonly string[]): string {
  const text = draft.trim()
  if (mentions.length === 0) return text
  return `${text || RESEARCH_SELECTION_DEFAULT_TEXT} ${mentions.join(' ')}`
}

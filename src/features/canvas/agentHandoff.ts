/**
 * 「把选中的节点交给 agent 当素材」——画布侧与对话窗之间的**单例交接**。
 *
 * 用户 2026-10-05 第 11 条：多选虚线框上方那排功能里，最后一个动作是「添加到 agent
 * 作为素材」。两边的组件是**兄弟**（画布 surface 与对话窗都挂在 `CanvasPage` 的槽位上），
 * 直接互相调用要一路透传四层 props；这里用一个模块级单例接一下，和剪贴板
 * （`useClipboard.ts`）同一套路数：**不进 store、不参与撤销**，它只是一次交接。
 *
 * 两个订阅方各取所需：
 * - `CanvasPage`：有交接就把对话窗**打开**（用户点了按钮，面板得像样地弹出来）；
 * - `AgentPanel`：把 ids 收进当前会话的 `pendingAssetIds` 并补成正文 chip。
 */

const pendingByProject = new Map<string, string[]>()
const listenersByProject = new Map<
  string,
  Set<(ids: readonly string[]) => void>
>()

export interface AgentReferenceHandoff {
  id: string
  label: string
}

const pendingReferencesByProject = new Map<
  string,
  AgentReferenceHandoff[]
>()
const referenceListenersByProject = new Map<
  string,
  Set<(refs: readonly AgentReferenceHandoff[]) => void>
>()

/** 画布侧调用：把选中的节点交给 agent（多次调用会累积） */
export function sendSelectionToAgent(
  projectId: string,
  ids: readonly string[],
): void {
  if (!projectId || ids.length === 0) return
  const pending = [
    ...new Set([...pendingByProject.get(projectId) ?? [], ...ids]),
  ]
  pendingByProject.set(projectId, pending)
  for (const fn of listenersByProject.get(projectId) ?? []) fn(pending)
}

/**
 * 对话窗调用：**取走并清空**。
 *
 * 必须取走而不是读：否则每次切会话 / 重渲染都会再收一遍同一批节点，
 * 正文里就会冒出重复的 chip。
 */
export function takeAgentHandoff(projectId: string): string[] {
  const out = pendingByProject.get(projectId) ?? []
  pendingByProject.delete(projectId)
  return out
}

export function subscribeAgentHandoff(
  projectId: string,
  fn: (ids: readonly string[]) => void,
): () => void {
  let listeners = listenersByProject.get(projectId)
  if (!listeners) {
    listeners = new Set()
    listenersByProject.set(projectId, listeners)
  }
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) listenersByProject.delete(projectId)
  }
}

/** 参考卡交给 Agent：一张卡一枚 reference chip；同 id 累积去重。 */
export function sendReferenceToAgent(
  projectId: string,
  refs: readonly AgentReferenceHandoff[],
): void {
  if (!projectId || refs.length === 0) return
  const byId = new Map(
    (pendingReferencesByProject.get(projectId) ?? []).map((ref) => [ref.id, ref]),
  )
  for (const ref of refs) {
    if (!ref.id) continue
    byId.set(ref.id, { id: ref.id, label: ref.label.trim() || ref.id })
  }
  const pending = [...byId.values()]
  pendingReferencesByProject.set(projectId, pending)
  for (const fn of referenceListenersByProject.get(projectId) ?? []) fn(pending)
}

export function takeReferenceAgentHandoff(
  projectId: string,
): AgentReferenceHandoff[] {
  const out = pendingReferencesByProject.get(projectId) ?? []
  pendingReferencesByProject.delete(projectId)
  return out
}

export function subscribeReferenceAgentHandoff(
  projectId: string,
  fn: (refs: readonly AgentReferenceHandoff[]) => void,
): () => void {
  let listeners = referenceListenersByProject.get(projectId)
  if (!listeners) {
    listeners = new Set()
    referenceListenersByProject.set(projectId, listeners)
  }
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) referenceListenersByProject.delete(projectId)
  }
}

/** 项目删除后同时清掉未消费交接与陈旧订阅，恢复项目时会重新注册。 */
export function clearAgentHandoff(projectId: string): void {
  pendingByProject.delete(projectId)
  listenersByProject.delete(projectId)
  pendingReferencesByProject.delete(projectId)
  referenceListenersByProject.delete(projectId)
}

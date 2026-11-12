/**
 * 技能 → Agent 的跨入口交接（技能页、画布技能浮层 → 画布 Agent 输入框的技能 chip）。
 *
 * 2026-11-12 起每个项目是一条**队列**：画布技能浮层里可以连续加入多个技能，
 * Agent 面板一直挂着、监听同步触发；而 LibTV 条目刚落成「我的技能」时 Agent 那边的
 * 技能列表可能还没刷新 —— 认不出的 id 留在队列里，等列表刷新后再取，不再被丢掉。
 */
const pendingByProject = new Map<string, string[]>()
const listenersByProject = new Map<
  string,
  Set<(skillId: string) => void>
>()
const libraryListenersByProject = new Map<string, Set<() => void>>()

export function sendSkillToAgent(
  projectId: string,
  skillId: string,
): void {
  if (!projectId) return
  const id = skillId.trim()
  if (!id) return
  const queue = pendingByProject.get(projectId) ?? []
  if (!queue.includes(id)) queue.push(id)
  pendingByProject.set(projectId, queue)
  for (const listener of listenersByProject.get(projectId) ?? []) {
    listener(id)
  }
}

/** 取出队首（兼容单条交接的老调用方）。 */
export function takeAgentSkillHandoff(projectId: string): string | null {
  const [first] = takeAgentSkillHandoffs(projectId, () => true)
  return first ?? null
}

/**
 * 按顺序取出 `accept` 认得的技能 id；不认得的留在队列里等下一次。
 */
export function takeAgentSkillHandoffs(
  projectId: string,
  accept: (skillId: string) => boolean,
): string[] {
  const queue = pendingByProject.get(projectId)
  if (!queue || queue.length === 0) return []
  const taken: string[] = []
  const kept: string[] = []
  for (const id of queue) {
    if (accept(id)) taken.push(id)
    else kept.push(id)
  }
  if (kept.length > 0) pendingByProject.set(projectId, kept)
  else pendingByProject.delete(projectId)
  return taken
}

export function subscribeAgentSkillHandoff(
  projectId: string,
  listener: (skillId: string) => void,
): () => void {
  let listeners = listenersByProject.get(projectId)
  if (!listeners) {
    listeners = new Set()
    listenersByProject.set(projectId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) listenersByProject.delete(projectId)
  }
}

/** 已删除项目的技能交接不得继续投递给残留订阅者。 */
export function clearAgentSkillHandoff(projectId: string): void {
  pendingByProject.delete(projectId)
  listenersByProject.delete(projectId)
  libraryListenersByProject.delete(projectId)
}

/**
 * Agent 输入框的技能按钮 → 画布页的技能浮层（2026-11-12）。
 *
 * Agent 面板由 AppShell 常驻渲染，不在画布页的 React 子树里，所以用按项目的订阅
 * 把「打开技能库」交给画布页。没有订阅者（不在画布页）时返回 false，调用方回落到技能页。
 */
export function requestAgentSkillLibrary(projectId: string): boolean {
  const listeners = libraryListenersByProject.get(projectId)
  if (!projectId || !listeners || listeners.size === 0) return false
  for (const listener of listeners) listener()
  return true
}

export function subscribeAgentSkillLibraryRequest(
  projectId: string,
  listener: () => void,
): () => void {
  let listeners = libraryListenersByProject.get(projectId)
  if (!listeners) {
    listeners = new Set()
    libraryListenersByProject.set(projectId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) libraryListenersByProject.delete(projectId)
  }
}

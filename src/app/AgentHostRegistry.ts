import type { ComponentType } from 'react'
import type { TaskShutdownControl } from '../features/shared/lifecycle/taskLifecycle'

/**
 * 应用壳常驻宿主的通用注册表。
 *
 * 记录只携带不透明 payload 与 renderer kind；AppShell / Outlet 不解读任何
 * 工作台类型，也不 import `workbenches/*`。具体 renderer 由对应工作台模块注册。
 */
export interface AgentHostRecord {
  id: string
  kind: string
  /** 同一项目重挂保留；HMR 先失效旧代际，旧 cleanup 不得删除新记录。 */
  generation: number
  active: boolean
  open: boolean
  payload: unknown
}

export interface AgentHostRendererProps {
  host: AgentHostRecord
}

export type AgentHostRenderer = ComponentType<AgentHostRendererProps>

export interface AgentHostRegistration {
  id: string
  kind: string
  payload: unknown
  active?: boolean
  open?: boolean
}

const renderers = new Map<string, AgentHostRenderer>()
const disposers = new Map<
  string,
  {
    generation: number
    beginShutdown: () => TaskShutdownControl
  }
>()
const generationFreezes = new Map<
  string,
  {
    generation: number
    owners: Set<symbol>
  }
>()
let recordsById = new Map<string, AgentHostRecord>()
let snapshot: readonly AgentHostRecord[] = []
const listeners = new Set<() => void>()
let nextGeneration = 1

function disposeKey(id: string, generation: number): string {
  return `${id}\u0000${generation}`
}

function notify(): void {
  for (const listener of listeners) listener()
}

function commit(
  next: Map<string, AgentHostRecord>,
): void {
  recordsById = next
  snapshot = [...next.values()]
  notify()
}

export function subscribeAgentHosts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getAgentHosts(): readonly AgentHostRecord[] {
  return snapshot
}

export function getAgentHost(id: string): AgentHostRecord | undefined {
  return recordsById.get(id)
}

export function registerAgentHostRenderer(
  kind: string,
  renderer: AgentHostRenderer,
): () => void {
  const current = renderers.get(kind)
  if (current === renderer) return () => undefined
  renderers.set(kind, renderer)
  notify()
  return () => {
    if (renderers.get(kind) !== renderer) return
    renderers.delete(kind)
    notify()
  }
}

export function getAgentHostRenderer(
  kind: string,
): AgentHostRenderer | undefined {
  return renderers.get(kind)
}

/** 幂等 upsert：同一项目 route 重挂只更新 runtime，不换 record。 */
export function upsertAgentHost(
  input: AgentHostRegistration,
): AgentHostRecord {
  const current = recordsById.get(input.id)
  if (current && current.kind !== input.kind) {
    throw new Error(
      `AgentHost ${input.id} 已注册为 ${current.kind}，不能改成 ${input.kind}`,
    )
  }
  const frozen = generationFreezes.get(input.id)
  if (frozen && !current) {
    return {
      id: input.id,
      kind: input.kind,
      generation: frozen.generation,
      active: false,
      open: false,
      payload: input.payload,
    }
  }
  const next: AgentHostRecord = {
    id: input.id,
    kind: input.kind,
    generation:
      frozen?.generation ??
      current?.generation ??
      nextGeneration++,
    active: input.active ?? current?.active ?? false,
    open: input.open ?? current?.open ?? false,
    payload: input.payload,
  }
  if (
    current &&
    current.active === next.active &&
    current.open === next.open &&
    Object.is(current.payload, next.payload)
  ) {
    return current
  }
  commit(new Map(recordsById).set(input.id, next))
  return next
}

/**
 * shutdown 期间锁住 host generation。
 *
 * HMR / bridge 重挂载仍可更新 payload，但必须复用同一个 record token，
 * 否则旧 disposal 清理完旧代际后会留下新 host。
 */
export function freezeAgentHostGeneration(
  id: string,
  generation: number,
): () => void {
  const owner = Symbol(id)
  const current = generationFreezes.get(id)
  if (current) {
    current.owners.add(owner)
  } else {
    generationFreezes.set(id, {
      generation,
      owners: new Set([owner]),
    })
  }
  let released = false
  return () => {
    if (released) return
    released = true
    const freeze = generationFreezes.get(id)
    if (!freeze) return
    freeze.owners.delete(owner)
    if (freeze.owners.size === 0) {
      generationFreezes.delete(id)
    }
  }
}

export function setAgentHostActive(
  id: string,
  active: boolean,
): void {
  const current = recordsById.get(id)
  if (!current || current.active === active) return
  commit(new Map(recordsById).set(id, { ...current, active }))
}

/** 只允许创建该 record 的 bridge 把自己停用，迟到 cleanup 不碰新 runtime。 */
export function deactivateAgentHost(
  id: string,
  payload: unknown,
): void {
  const current = recordsById.get(id)
  if (!current || !Object.is(current.payload, payload)) return
  setAgentHostActive(id, false)
}

export function setAgentHostOpen(
  id: string,
  open: boolean,
): void {
  const current = recordsById.get(id)
  if (!current || current.open === open) return
  commit(new Map(recordsById).set(id, { ...current, open }))
}

export function removeAgentHost(
  id: string,
  expectedGeneration?: number,
): boolean {
  const current = recordsById.get(id)
  if (!current) return false
  if (
    expectedGeneration !== undefined &&
    current.generation !== expectedGeneration
  ) {
    return false
  }
  disposers.delete(disposeKey(id, current.generation))
  const next = new Map(recordsById)
  next.delete(id)
  commit(next)
  return true
}

export function setAgentHostDisposer(
  id: string,
  beginShutdown: () => TaskShutdownControl,
  generation = recordsById.get(id)?.generation,
): () => void {
  if (generation === undefined) return () => undefined
  const key = disposeKey(id, generation)
  disposers.set(key, { generation, beginShutdown })
  return () => {
    if (disposers.get(key)?.beginShutdown === beginShutdown) {
      disposers.delete(key)
    }
  }
}

export function beginAgentHostDispose(
  id: string,
  generation = recordsById.get(id)?.generation,
): TaskShutdownControl | null {
  if (generation === undefined) return null
  const key = disposeKey(id, generation)
  const entry = disposers.get(key)
  return entry?.beginShutdown() ?? null
}

export function finalizeAgentHostDispose(
  id: string,
  generation = recordsById.get(id)?.generation,
): boolean {
  if (generation === undefined) return false
  const key = disposeKey(id, generation)
  if (disposers.has(key)) disposers.delete(key)
  return true
}

/** 只等待宿主自身 abort + flush；项目删除协调器在全部成功后才会移除 record。 */
export async function waitForAgentHostDispose(
  id: string,
  generation = recordsById.get(id)?.generation,
): Promise<void> {
  const control = beginAgentHostDispose(id, generation)
  if (!control) return
  try {
    await control.waitForIdle()
  } catch (error) {
    if (!control.reopenIfIdle()) {
      void control.whenIdle().then(() => control.reopenIfIdle())
    }
    throw error
  }
}

/** 项目删除 / 测试用：先 abort + flush，再按代际条件移除常驻 record。 */
export async function disposeAgentHost(
  id: string,
  generation = recordsById.get(id)?.generation,
): Promise<void> {
  const control = beginAgentHostDispose(id, generation)
  if (!control) {
    removeAgentHost(id, generation)
    return
  }
  try {
    await control.waitForIdle()
  } catch (error) {
    if (!control.reopenIfIdle()) {
      void control.whenIdle().then(() => control.reopenIfIdle())
    }
    throw error
  }
  if (!control.finalize()) {
    throw new Error(`AgentHost ${id} 未能安全关闭`)
  }
  finalizeAgentHostDispose(id, generation)
  removeAgentHost(id, generation)
}

/**
 * HMR 同步失效当前代际，但不 notify 旧 renderer。
 *
 * recordsById 已经换到新代际，旧 disposer / cleanup 即使晚到也只能命中旧 token；
 * 随后新模块 upsert 时沿用这个新代际并发布，不会恢复旧异步清理的所有权。
 */
export function invalidateAgentHostsForHmr(
  kind: string,
): AgentHostRecord[] {
  const invalidated: AgentHostRecord[] = []
  const next = new Map(recordsById)
  for (const [id, current] of recordsById) {
    if (current.kind !== kind) continue
    invalidated.push(current)
    if (generationFreezes.has(id)) {
      next.set(id, current)
      continue
    }
    next.set(id, {
      ...current,
      generation: nextGeneration++,
    })
  }
  recordsById = next
  return invalidated
}

/** 仅测试使用：清空记录和 renderer，验证删除与 StrictMode 行为。 */
export function resetAgentHostsForTests(): void {
  recordsById = new Map()
  snapshot = []
  renderers.clear()
  disposers.clear()
  generationFreezes.clear()
  nextGeneration = 1
  notify()
}

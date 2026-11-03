import type { ComponentType } from 'react'

/**
 * 应用壳常驻宿主的通用注册表。
 *
 * 记录只携带不透明 payload 与 renderer kind；AppShell / Outlet 不解读任何
 * 工作台类型，也不 import `workbenches/*`。具体 renderer 由对应工作台模块注册。
 */
export interface AgentHostRecord {
  id: string
  kind: string
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
const disposers = new Map<string, () => Promise<void>>()
let recordsById = new Map<string, AgentHostRecord>()
let snapshot: readonly AgentHostRecord[] = []
const listeners = new Set<() => void>()

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
  const next: AgentHostRecord = {
    id: input.id,
    kind: input.kind,
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

export function removeAgentHost(id: string): void {
  if (!recordsById.has(id)) return
  disposers.delete(id)
  const next = new Map(recordsById)
  next.delete(id)
  commit(next)
}

export function setAgentHostDisposer(
  id: string,
  dispose: () => Promise<void>,
): () => void {
  disposers.set(id, dispose)
  return () => {
    if (disposers.get(id) === dispose) disposers.delete(id)
  }
}

/** 项目删除 / HMR 用：先 abort + flush，再移除常驻 record。 */
export async function disposeAgentHost(id: string): Promise<void> {
  const dispose = disposers.get(id)
  if (dispose) await dispose()
  removeAgentHost(id)
}

/** 仅测试使用：清空记录和 renderer，验证删除与 StrictMode 行为。 */
export function resetAgentHostsForTests(): void {
  recordsById = new Map()
  snapshot = []
  renderers.clear()
  disposers.clear()
  notify()
}

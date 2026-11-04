import type { AgentNodeType } from '../../../../domain/agent/plan'

export type AgentNodeDefaults = Partial<
  Record<AgentNodeType, Record<string, unknown>>
>

export interface AgentToolDefaultsPorts {
  /** 单个类型的默认值（画布侧由 `resolveDefaults({ channels, type })` 提供）。 */
  defaultsFor: (type: AgentNodeType) => Promise<Record<string, unknown>>
}

/**
 * agent 建的节点要和手建的节点使用同一套默认值。
 *
 * 逐类型**串行**取值：既是拆分前的顺序（`resolveDefaults` 会读写渠道目录，并行没有收益），
 * 也让「某个类型取默认值失败」按原样向上抛，而不是被折成半份 map。
 */
export async function buildAgentToolDefaults(
  types: readonly AgentNodeType[],
  ports: AgentToolDefaultsPorts,
): Promise<AgentNodeDefaults> {
  const out: AgentNodeDefaults = {}
  for (const type of types) out[type] = await ports.defaultsFor(type)
  return out
}

export function createAgentToolDefaults(ports: AgentToolDefaultsPorts): {
  defaultsForNewNode: (
    types: readonly AgentNodeType[],
  ) => Promise<AgentNodeDefaults>
} {
  return {
    defaultsForNewNode: (types) => buildAgentToolDefaults(types, ports),
  }
}

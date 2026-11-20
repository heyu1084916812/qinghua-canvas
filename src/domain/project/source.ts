import type { ProtocolDefinition, ProtocolFamily } from './protocol'

/**
 * 来源是渠道之上的稳定分类；协议仍负责描述具体 HTTP / CLI 合约。
 *
 * 这一层故意不把站点、模型或参数复制进来：同一个来源可以有多个站点，
 * 一个站点也可以暴露多个协议。先把分类规则集中在领域层，后续设置页和
 * 创作面板都能共享，而不会各自按协议 id 猜来源。
 */
export type SourceKind = 'api' | 'cli' | 'comfyui' | 'local-model'

export type AuthKind = 'api-key' | 'oauth' | 'cli-session' | 'none'

export interface ProtocolSourceDescriptor {
  protocolId: string
  /** 稳定站点 / 协议身份；不使用展示名称，避免改名破坏存储。 */
  siteId: string
  sourceKind: SourceKind
  authKind: AuthKind
}

function sourceKindForFamily(family: ProtocolFamily, protocolId: string): SourceKind {
  if (family === 'cli-gateway') return 'cli'
  if (family === 'mock' || protocolId === 'mock') return 'local-model'
  return 'api'
}

/** 从协议声明推导来源，不按站点名称或 baseUrl 猜。 */
export function protocolSourceDescriptor(
  definition: Pick<ProtocolDefinition, 'id' | 'family' | 'credentials'>,
): ProtocolSourceDescriptor {
  const sourceKind = sourceKindForFamily(definition.family, definition.id)
  let authKind: AuthKind
  if (sourceKind === 'cli') {
    authKind = 'cli-session'
  } else if (sourceKind === 'local-model') {
    authKind = 'none'
  } else if (
    definition.family === 'openai-compatible' ||
    definition.family === 'async-task' ||
    (definition.credentials?.length ?? 0) > 0
  ) {
    authKind = 'api-key'
  } else {
    authKind = 'none'
  }
  return {
    protocolId: definition.id,
    siteId: definition.id,
    sourceKind,
    authKind,
  }
}

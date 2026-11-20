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

/**
 * #1118 P2：站点层的稳定元数据。
 *
 * 协议是“怎么调用”，站点是“调用谁”。两者不能继续用协议 id 充当同一个
 * 标识，否则同一站点的 API / CLI / 本地入口会被 UI 和设置页拆成互不相干的服务。
 * 这里仍是纯领域数据；图标和具体动作由上层按 `iconKey` / `operations` 接入。
 */
export interface SourceSiteDescriptor extends ProtocolSourceDescriptor {
  label: string
  iconKey: string
  protocolIds: readonly string[]
  operations: SourceOperationSupport
}

const SITE_OVERRIDES: Readonly<Record<string, Pick<SourceSiteDescriptor, 'siteId' | 'label' | 'iconKey'>>> = {
  'jimeng-cli': { siteId: 'jimeng', label: '即梦', iconKey: 'jimeng' },
  'gemini-cli': { siteId: 'gemini', label: 'Gemini', iconKey: 'gemini' },
  'gpt-cli': { siteId: 'codex', label: 'Codex', iconKey: 'codex' },
  'jimeng-cli-gateway': { siteId: 'jimeng', label: '即梦', iconKey: 'jimeng' },
}

function defaultSiteLabel(definition: Pick<ProtocolDefinition, 'id'>): string {
  return definition.id
}

function defaultIconKey(definition: Pick<ProtocolDefinition, 'id'>): string {
  return definition.id
}

/** 从协议目录生成站点视图；同站点协议共享 siteId，协议本身仍保持独立。 */
export function sourceSiteDescriptorOf(
  definition: Pick<ProtocolDefinition, 'id' | 'family' | 'credentials'>,
): SourceSiteDescriptor {
  const protocol = protocolSourceDescriptor(definition)
  const override = SITE_OVERRIDES[definition.id]
  const siteId = override?.siteId ?? protocol.siteId
  return {
    ...protocol,
    siteId,
    label: override?.label ?? defaultSiteLabel(definition),
    iconKey: override?.iconKey ?? defaultIconKey(definition),
    protocolIds: [definition.id],
    operations: sourceOperationsFor(protocol),
  }
}

/**
 * 把协议目录投影为站点目录；同一站点的多条协议只出现一次，协议顺序保持输入顺序。
 * 这是设置页 / 来源选择器后续应消费的唯一聚合入口。
 */
export function sourceSiteCatalogOf(
  definitions: readonly Pick<ProtocolDefinition, 'id' | 'family' | 'credentials'>[],
): SourceSiteDescriptor[] {
  const sites = new Map<string, SourceSiteDescriptor>()
  for (const definition of definitions) {
    const next = sourceSiteDescriptorOf(definition)
    const current = sites.get(next.siteId)
    if (!current) {
      sites.set(next.siteId, next)
      continue
    }
    sites.set(next.siteId, {
      ...current,
      protocolIds: [...current.protocolIds, definition.id],
      operations: {
        verify: current.operations.verify || next.operations.verify,
        listModels: current.operations.listModels || next.operations.listModels,
        login: current.operations.login || next.operations.login,
        logout: current.operations.logout || next.operations.logout,
        status: current.operations.status || next.operations.status,
        quickTest: current.operations.quickTest || next.operations.quickTest,
        cancel: current.operations.cancel || next.operations.cancel,
      },
    })
  }
  return [...sites.values()]
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


/** #1118 P1：所有来源对外暴露同一组生命周期动作；实现可以明确声明不支持。 */
export type SourceOperation =
  | 'verify'
  | 'listModels'
  | 'login'
  | 'logout'
  | 'status'
  | 'quickTest'
  | 'cancel'

export type SourceOperationSupport = Readonly<Record<SourceOperation, boolean>>

const API_KEY_OPERATIONS: SourceOperationSupport = {
  verify: true,
  listModels: true,
  login: false,
  logout: false,
  status: true,
  quickTest: true,
  cancel: true,
}

const CLI_OPERATIONS: SourceOperationSupport = {
  verify: true,
  listModels: true,
  login: true,
  logout: true,
  status: true,
  quickTest: true,
  cancel: true,
}

const LOCAL_OPERATIONS: SourceOperationSupport = {
  verify: true,
  listModels: true,
  login: false,
  logout: false,
  status: true,
  quickTest: true,
  cancel: true,
}

/**
 * 只描述能力，不伪造具体适配器：调用方仍需从 platform registry 取实现。
 * `api-key` 没有 login/logout 是有意的，填 Key 不是 OAuth 登录。
 */
export function sourceOperationsFor(
  descriptor: Pick<ProtocolSourceDescriptor, 'sourceKind' | 'authKind'>,
): SourceOperationSupport {
  if (descriptor.sourceKind === 'cli' || descriptor.authKind === 'cli-session') {
    return CLI_OPERATIONS
  }
  if (descriptor.sourceKind === 'local-model') return LOCAL_OPERATIONS
  return API_KEY_OPERATIONS
}

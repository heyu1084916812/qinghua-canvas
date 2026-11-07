/**
 * 3D 生成能力的发布后递延边界。设置页的 3D 筛选只是可见但不可选的空态，
 * 不代表领域类型、适配器、端点、节点/结果形态或真实验收已经存在。
 */
export interface ThreeDCapabilitySpec {
  readonly status: 'deferred'
  readonly generation: false
  readonly uiFilter: {
    readonly visibility: 'visible'
    readonly selectable: false
    readonly state: 'empty'
  }
  readonly runtimeCategories: readonly ('image' | 'chat' | 'video' | 'audio' | 'unknown')[]
  readonly protocolCapabilities: readonly ('chat' | 'image' | 'video' | 'audio')[]
  readonly prerequisites: readonly [
    'domain-types-and-routing',
    'registered-channel-adapter',
    'verified-generation-endpoint',
    'node-and-result-shapes',
    'real-endpoint-acceptance',
  ]
}

export const THREE_D_CAPABILITY_SPEC: ThreeDCapabilitySpec = Object.freeze({
  status: 'deferred' as const,
  generation: false as const,
  uiFilter: Object.freeze({
    visibility: 'visible' as const,
    selectable: false as const,
    state: 'empty' as const,
  }),
  runtimeCategories: Object.freeze(['image', 'chat', 'video', 'audio', 'unknown'] as const),
  protocolCapabilities: Object.freeze(['chat', 'image', 'video', 'audio'] as const),
  prerequisites: Object.freeze([
    'domain-types-and-routing',
    'registered-channel-adapter',
    'verified-generation-endpoint',
    'node-and-result-shapes',
    'real-endpoint-acceptance',
  ] as const),
})

/**
 * 当前唯一能力判定。五项前提与真实验收完成前恒为 false；
 * 不从设置页空态或联合类型反推「已支持」。
 */
export function threeDGenerationSupported(): false {
  return false
}

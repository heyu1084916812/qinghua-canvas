/**
 * 项目参考台账的规则层。
 *
 * 一张参考卡只登记「它是什么」；同一个素材在不同任务里可以有多条「怎么用」。
 * 生成前按当前任务的 usage 选中记录，只有命中的素材才允许写进生成参数。
 * 素材字节仍在 `assets`，本层不持有图片、不读 DOM、不认识 React。
 */

export type ReferenceSource =
  | 'file'
  | 'link'
  | 'asset'
  | 'kit'
  | 'pinterest'
  | 'clipper'
  | 'webFetch'
  | 'search'

export type ReferenceKind =
  | 'image'
  | 'video'
  | 'document'
  | 'color'
  | 'font'
  | 'audio'
  | 'text'

export type ReferenceUsageKind =
  | 'subject'
  | 'style'
  | 'composition'
  | 'identityAnchor'
  | 'avoid'
  | 'textGuide'

export interface ReferenceAssetRef {
  hash: string
  role: 'logo' | 'reference'
  name: string
}

export interface ReferenceItem {
  id: string
  projectId: string
  title: string
  source: ReferenceSource
  kind: ReferenceKind
  /** 内容地址或纯 URL；文本卡可为空。 */
  assetHash?: string
  /** 一张参考卡携带的多资产集合；assetHash 继续作为主预览和兼容入口。 */
  assets?: readonly ReferenceAssetRef[]
  url?: string
  /** 套件、Pinterest 等来源的冻结引用。 */
  kitId?: string
  kitVersion?: number
  /** What：主体、风格、构图、颜色等基础描述。 */
  what: string
  createdAt: number
  updatedAt: number
}

export interface ReferenceUsage {
  id: string
  itemId: string
  projectId: string
  /** 任务标识：同一会话可有多个生成任务；稳态字符串便于复用历史用法。 */
  taskKey: string
  usage: ReferenceUsageKind
  /** How to use：借鉴什么、避开什么、是否锁定身份。 */
  howToUse: string
  /** 身份锚点必须排在普通风格参考之前。 */
  identityAnchor?: boolean
  /** 按用户问题卡回答重写过的用法（G9）：最高优先级，后续自动分析不得覆盖。 */
  confirmedByUser?: true
  createdAt: number
  /** 最近一次（重新）分析写入的时间；同图多任务时卡片显示最新写入的那条。 */
  updatedAt?: number
}

/** 一张参考卡的「当前」用法：多任务各自保留，卡片显示最近写入的一条。 */
export function latestUsageForItem(
  usages: readonly ReferenceUsage[],
  itemId: string | undefined,
): ReferenceUsage | undefined {
  let latest: ReferenceUsage | undefined
  for (const usage of usages) {
    if (usage.itemId !== itemId) continue
    const at = usage.updatedAt ?? usage.createdAt
    if (!latest || at >= (latest.updatedAt ?? latest.createdAt)) latest = usage
  }
  return latest
}

export interface SelectedReference {
  item: ReferenceItem
  usage: ReferenceUsage
}

export interface ReferenceSelection {
  selected: SelectedReference[]
  omitted: { item: ReferenceItem; reason: 'task_mismatch' | 'no_usage' | 'avoid' }[]
}

export function selectReferencesForTask(input: {
  items: readonly ReferenceItem[]
  usages: readonly ReferenceUsage[]
  projectId: string
  taskKey: string
}): ReferenceSelection {
  const usageByItem = new Map<string, ReferenceUsage>()
  for (const usage of input.usages) {
    if (usage.projectId !== input.projectId || usage.taskKey !== input.taskKey) continue
    const current = usageByItem.get(usage.itemId)
    if (!current || rankUsage(usage) > rankUsage(current)) {
      usageByItem.set(usage.itemId, usage)
    }
  }
  const selected: SelectedReference[] = []
  const omitted: ReferenceSelection['omitted'] = []
  for (const item of input.items) {
    if (item.projectId !== input.projectId) continue
    const usage = usageByItem.get(item.id)
    if (!usage) {
      omitted.push({ item, reason: 'no_usage' })
      continue
    }
    if (usage.usage === 'avoid') {
      omitted.push({ item, reason: 'avoid' })
      continue
    }
    selected.push({ item, usage })
  }
  selected.sort((left, right) =>
    rankUsage(right.usage) - rankUsage(left.usage) ||
    left.item.createdAt - right.item.createdAt ||
    left.item.id.localeCompare(right.item.id),
  )
  return { selected, omitted }
}

function rankUsage(usage: ReferenceUsage): number {
  if (usage.usage === 'identityAnchor' || usage.identityAnchor) return 4
  // 主体 / 产品锁定（G3）：和身份锚点一样必须保真，排在版式与风格参考之前。
  if (usage.usage === 'subject') return 4
  if (usage.usage === 'composition') return 3
  if (usage.usage === 'textGuide') return 2
  if (usage.usage === 'style') return 1
  return 0
}

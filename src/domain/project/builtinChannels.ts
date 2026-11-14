import { createChannel, type Channel, type CreateChannelInput } from './channel'
import { BUILTIN_CATALOG, protocolById, type ProtocolCatalog } from './protocol'

/**
 * **常驻内置渠道**（用户第 20 批起，后续按站点持续补充）。
 *
 * 从参考产品最初的 ModelScope / Agnes / RunningHub，到后续补充的站点协议 ——
 * 它们是**渠道列表里常驻的行**：一直在最上面、**不出现在"点击新建"里**、
 * **不能删除**；**名称与协议固定**，**站点地址留口子（可改）**；
 * 令牌 / 启用 / 模型选择照常由用户配（那是"你这台机器上怎么用它"）。
 *
 * ## 为什么 id 写死而不是 `createId`
 *
 * "它已经存在吗"要能**按 id 判**：每次启动都新建一遍的话，用户会攒出一串同名渠道；
 * 而按"名字相同就复用"又会被用户改过的名字骗过。写死的 id 是这两条之外的第三条路。
 * 前缀 `ch_builtin_` 同时就是**判据**（`isBuiltinChannelId`），界面与命令层共用它。
 *
 * ## 排序位取负数
 *
 * 用户的渠道从 0 往后排（`repo.create` 取 max+1）⇒ 负数天然永远在最前，
 * 不需要"每次加载都把三条搬到队首"那种会跟用户拖动打架的操作。
 */
export const BUILTIN_CHANNEL_IDS = [
  'ch_builtin_modelscope',
  'ch_builtin_agnes',
  'ch_builtin_runninghub',
  'ch_builtin_runninghub_global',
  'ch_builtin_soonstudio',
  'ch_builtin_65535_chat',
] as const

/**
 * 已退役的内置渠道 id。
 *
 * 65535 从「对话 / 生图两条内置渠道」收敛成一条合并渠道后，旧的任务行需要
 * 安静退场；但仅在**用户没配过令牌、也没勾过模型**时清掉，配过的一律保留，
 * 避免升级时抹掉用户已有工作。
 */
export const RETIRED_BUILTIN_CHANNEL_IDS = ['ch_builtin_65535_task'] as const

/** 内置渠道的排序位基准（实际用 `BASE + 序号`，越小越靠前） */
export const BUILTIN_ORDER_BASE = -1000

export interface BuiltinChannelSpec {
  id: string
  /** 固定名称（用户改不了） */
  name: string
  /** 固定协议（用户改不了） */
  protocol: string
  /**
   * 固定初始地址（可选）。
   *
   * 只有「同一条协议、两个站」的内置渠道才需要它（RunningHub 国内站 / 国际站）：
   * 协议目录里只有一个 `defaultBaseUrl`，第二条渠道必须自带地址，否则会落到国内站。
   * 地址仍**可改**（用户可能指到自建反代），这里只是初始值。
   */
  baseUrl?: string
}

/**
 * 内置渠道**历史默认名**（按 id）。
 *
 * 名称本来是用户可改的资料，我们不做"每次启动都覆盖"。但内置渠道自己改名时
 * （例如 RunningHub 拆成国内站 / 国际站），老装机上那条还叫旧名字，
 * 用户会看到「RunningHub」和一个新名字并列。折中：**只在名字仍是某个历史默认值**时跟着改；
 * 用户自己改成别的名字说明他有主意，不动。
 */
export const LEGACY_BUILTIN_NAMES: Record<string, readonly string[]> = {
  ch_builtin_runninghub: ['RunningHub', 'RunningHub 国内站'],
  ch_builtin_runninghub_global: ['RunningHub 国际站'],
}

export const BUILTIN_CHANNELS: readonly BuiltinChannelSpec[] = [
  { id: 'ch_builtin_modelscope', name: 'ModelScope 魔搭', protocol: 'modelscope' },
  { id: 'ch_builtin_agnes', name: 'Agnes', protocol: 'agnes' },
  /** RunningHub 用 **API** 那条（用户：「runninghub它也有api」）；CLI 那条仍留给本机用法 */
  /**
   * 名字**把站放在品牌前面**：侧栏那一行只有十来个字宽，`RunningHub 国内站 / 国际站`
   * 截断后两行都变成「RunningHub 国…」，等于没分；`国内站 · RunningHub` 截断后
   * 第一眼就能看出是哪一站（品牌留在后半段，需要时看抬头那行）。
   */
  { id: 'ch_builtin_runninghub', name: '国内站 · RunningHub', protocol: 'runninghub-api' },
  /**
   * 国际站：**同一条协议、另一个站**。两个站是两个账号、两把 Key（用户 2026-11-14），
   * 所以做成两条内置渠道而不是一个下拉 —— 各自的 Key、余额、模型与工作流都分开。
   */
  {
    id: 'ch_builtin_runninghub_global',
    name: '国际站 · RunningHub',
    protocol: 'runninghub-api',
    baseUrl: 'https://www.runninghub.ai',
  },
  { id: 'ch_builtin_soonstudio', name: 'SoonStudio', protocol: 'soonstudio' },
  /** id 沿用旧的 `_chat`，只为让已存在的内置行原地升级成合并协议 */
  { id: 'ch_builtin_65535_chat', name: '65535', protocol: '65535' },
]

/** 这条渠道是不是内置的（界面据此禁用删除 / 锁定名称与协议） */
export function isBuiltinChannelId(id: string): boolean {
  return (BUILTIN_CHANNEL_IDS as readonly string[]).includes(id)
}

export function builtinSpecOf(id: string): BuiltinChannelSpec | undefined {
  return BUILTIN_CHANNELS.find((c) => c.id === id)
}

/**
 * 造一条内置渠道（**用于补齐缺失的那几条**，不覆盖已存在的）。
 *
 * 地址取协议目录的 `defaultBaseUrl`（唯一来源，与界面上"选中即填地址"同一份）；
 * 协议没写默认地址时留空，让用户在界面上自己填（不猜）。
 */
export function createBuiltinChannel(
  spec: BuiltinChannelSpec,
  index: number,
  catalog: ProtocolCatalog = BUILTIN_CATALOG,
): Channel {
  const def = protocolById(spec.protocol, catalog)
  const input: CreateChannelInput = {
    name: spec.name,
    protocol: spec.protocol,
    baseUrl: spec.baseUrl ?? def?.defaultBaseUrl ?? '',
    order: BUILTIN_ORDER_BASE + index,
  }
  const ch = createChannel(input)
  /** id 写死（`createChannel` 生成的那个丢弃）+ 新建即启用（与 #353 同口径） */
  return { ...ch, id: spec.id, order: BUILTIN_ORDER_BASE + index }
}

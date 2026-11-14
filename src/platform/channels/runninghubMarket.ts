import type { NetworkResponse, PlatformKit } from '../ports'
import { ChannelError } from './types'

/**
 * RunningHub **API 市场目录**（对账 #1113）。
 *
 * 为什么要这块：用户要「只扣运行时长（不叠加第三方模型调用费）」的那批工作流，
 * 而市场页 `/call-api/search-api/workflow` 的数据来自 **免登录、免 Key** 的
 * `POST /api/sku/list` —— 不用让用户去网页上抄 id。
 *
 * 这里只做两件事：**读目录**、**把一条 SKU 翻成"能不能跑、跑起来是哪条 id"**。
 * 字段表（参数）仍由 `runninghubWorkflow.ts` 去拉，落库在 `workflowEntryStore`。
 *
 * ⚠️ 一个真坑（2026-11-14 实测）：市场页上的 `id` 是 **SKU id**，不是 `webappId`/`workflowId`；
 * 真实业务 id 在详情接口的 `relatedDataId` 里。列表接口**不带**这个字段，所以
 * 「添加条目」必须再打一次 `/api/sku/detail`。
 */

export type RhMarketKind = 'WORKFLOW' | 'WEBAPP'

/** 计费标签：市场卡片上只有这两种（`运行时长费用` / `标准模型API调用费用+运行时长费用`） */
export type RhMarketBilling = 'runtime' | 'runtime+model'

export interface RhMarketEntry {
  /** 市场 SKU id（19 位字符串） */
  skuId: string
  kind: RhMarketKind
  title: string
  description: string
  categoryName: string
  coverUrl: string
  billing: RhMarketBilling
  runCount: string
  /** 真实业务 id（`webappId` / `workflowId`）；列表里拿不到，详情里才有 */
  relatedDataId: string
}

export const RH_MARKET_DEFAULT_HOST = 'https://www.runninghub.cn'
const SKU_LIST_PATH = '/api/sku/list'
const SKU_DETAIL_PATH = '/api/sku/detail'
const MARKET_TIMEOUT_MS = 30_000
/** 一次取全：实测三个市场分别 280 / 15 / 18 条，999 足够且服务端接受 */
const MARKET_PAGE_SIZE = 999

interface Envelope {
  code?: number | string
  msg?: string
  message?: string
  data?: unknown
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function hostOf(host?: string): string {
  return (host || RH_MARKET_DEFAULT_HOST).replace(/\/+$/, '')
}

/** `priceType` 1 = 只收运行时长（积分）；2 = 另加第三方模型调用费（CNY） */
export function billingOf(priceType: unknown): RhMarketBilling {
  return Number(priceType) === 2 ? 'runtime+model' : 'runtime'
}

/** 一条 SKU 记录 → 条目；认不出的（没有 id / 没有名字）返回 null，不编假行 */
export function mapSkuRecord(raw: unknown, kind: RhMarketKind): RhMarketEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const skuId = textOf(record.id)
  const title = textOf(record.name)
  if (!skuId || !title) return null
  return {
    skuId,
    kind,
    title,
    description: textOf(record.description),
    categoryName: textOf(record.categoryName),
    coverUrl: textOf(record.backgroundUrl),
    billing: billingOf(record.priceType),
    runCount: textOf(record.runCount),
    relatedDataId: textOf(record.relatedDataId),
  }
}

/** 只要「免费版」：不叠加第三方模型调用费的那批 */
export function runtimeOnly(entries: readonly RhMarketEntry[]): RhMarketEntry[] {
  return entries.filter((entry) => entry.billing === 'runtime')
}

async function readJson(res: NetworkResponse, fallback: string): Promise<Envelope> {
  const body = await res.text()
  if (res.status >= 400) {
    throw new ChannelError({ kind: 'http', status: res.status, body: body.slice(0, 300) })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body) as unknown
  } catch {
    throw new ChannelError({ kind: 'parse', raw: `${fallback}：返回了非 JSON（${body.slice(0, 160)}）` })
  }
  return parsed && typeof parsed === 'object' ? (parsed as Envelope) : {}
}

function failureOf(envelope: Envelope, fallback: string): string {
  return textOf(envelope.msg) || textOf(envelope.message) || fallback
}

/**
 * 市场列表。**不需要 Key**（这是公开目录，市场页自己也是匿名拉的）。
 *
 * `search` 是真能用的关键词（实测 `BJD` 命中 1 条）；`pageSize` 给 999 一次取全，
 * 免得前端做分页状态。
 */
export async function fetchRhMarketEntries(
  deps: Pick<PlatformKit, 'network'>,
  options: { kind: RhMarketKind; host?: string; search?: string },
  signal: AbortSignal,
): Promise<RhMarketEntry[]> {
  const res = await deps.network.request(
    {
      url: `${hostOf(options.host)}${SKU_LIST_PATH}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        categoryType: options.kind,
        tagIds: [],
        search: options.search ?? '',
        categoryTagIds: [],
        owners: [],
        isCollected: false,
        region: '',
        isWhitelist: false,
        pageNum: 1,
        pageSize: MARKET_PAGE_SIZE,
      },
      timeoutMs: MARKET_TIMEOUT_MS,
    },
    signal,
  )
  const envelope = await readJson(res, 'RunningHub 市场目录读取失败')
  if (envelope.code !== 0) {
    throw new ChannelError({ kind: 'http', status: 400, body: failureOf(envelope, 'RunningHub 市场目录读取失败') })
  }
  const page = (envelope.data ?? {}) as { page?: { records?: unknown } }
  const records = Array.isArray(page.page?.records) ? (page.page!.records as unknown[]) : []
  const out: RhMarketEntry[] = []
  for (const record of records) {
    const mapped = mapSkuRecord(record, options.kind)
    if (mapped) out.push(mapped)
  }
  return out
}

/**
 * 单条 SKU 的详情 —— **只为拿 `relatedDataId`**（真实 `webappId` / `workflowId`）。
 *
 * 不把封面/描述再读一遍：列表里已经有，两处读会漂移。
 */
export async function fetchRhMarketRelatedId(
  deps: Pick<PlatformKit, 'network'>,
  skuId: string,
  options: { host?: string } = {},
  signal?: AbortSignal,
): Promise<string> {
  const res = await deps.network.request(
    {
      url: `${hostOf(options.host)}${SKU_DETAIL_PATH}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { id: skuId },
      timeoutMs: MARKET_TIMEOUT_MS,
    },
    signal ?? new AbortController().signal,
  )
  const envelope = await readJson(res, 'RunningHub 市场条目详情读取失败')
  if (envelope.code !== 0) {
    throw new ChannelError({ kind: 'http', status: 400, body: failureOf(envelope, 'RunningHub 市场条目详情读取失败') })
  }
  const data = (envelope.data ?? {}) as Record<string, unknown>
  const related = textOf(data.relatedDataId)
  if (!related) {
    throw new ChannelError({
      kind: 'parse',
      raw: '这条市场条目没有 relatedDataId（拿不到真实的 workflowId / webappId）',
    })
  }
  return related
}

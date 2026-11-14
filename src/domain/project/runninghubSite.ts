/**
 * RunningHub 的**两个站**（国内站 / 国际站）。
 *
 * 用户 2026-11-14：「这是独属于 runninghub 的设置，国内站和国际站是两个 key 的吧，
 * 因为账号都不同」——它们是两个独立账号体系、两本账、两套模型与工作流。
 * 我们做成**两条内置渠道**（各自一把 Key），这里只负责「这条渠道是哪一站」以及
 * 「这一站要怎么跟用户说清楚」这两件纯事。
 *
 * 为什么按**地址**判而不是按渠道 id：内置渠道的地址是用户可以改的
 *（例如把国际站渠道指到自建反代），真正决定用哪套账号的是这个地址打到哪，
 * 不是我们给的那行 id。
 */

export type RunningHubSite = 'cn' | 'global' | 'unknown'

export const RUNNINGHUB_SITES: Record<Exclude<RunningHubSite, 'unknown'>, string> = {
  cn: 'https://www.runninghub.cn',
  global: 'https://www.runninghub.ai',
}

export function runninghubSiteOf(baseUrl: string): RunningHubSite {
  const host = String(baseUrl ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
  if (!host) return 'unknown'
  if (host === 'runninghub.cn' || host.endsWith('.runninghub.cn')) return 'cn'
  if (host === 'runninghub.ai' || host.endsWith('.runninghub.ai')) return 'global'
  return 'unknown'
}

const SITE_NOTE: Record<RunningHubSite, string> = {
  cn: 'RunningHub 国内站（runninghub.cn）：与国际站是两个账号、两把 Key，模型与工作流各自独立。AI 应用 / 自建工作流用这把 Key；标准模型 API 只对企业级-共享 Key 开放（消费级 Key 会回 1014）。',
  global: 'RunningHub 国际站（runninghub.ai）：与国内站是两个账号、两把 Key，模型与工作流各自独立。标准模型 API、AI 应用、自建工作流都在这一站，调用不会走国内站。',
  unknown: '自定义地址：按 RunningHub 的 OpenAPI 打（提交任务 + 轮询取结果）。地址指向哪一站，就用哪一站的账号与余额。',
}

/**
 * 协议说明按站点改写。
 *
 * 协议本身只有一条（`runninghub-api`），但**能力不一样**：国内站的标准模型 API
 * 只对企业级共享 Key 开放，拿消费级 Key 去调会回 1014；国际站没有这条限制。
 * 同一句说明挂到两条渠道上必然有一句是错的，所以在渲染前按站点换词。
 */
export function runninghubSiteNote(
  channel: { protocol: string; baseUrl: string } | null | undefined,
  fallback: string,
): string {
  if (!channel || channel.protocol !== 'runninghub-api') return fallback
  return SITE_NOTE[runninghubSiteOf(channel.baseUrl)]
}

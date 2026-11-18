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

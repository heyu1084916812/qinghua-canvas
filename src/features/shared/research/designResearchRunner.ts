import type { InspirationCase } from '../../../domain/inspiration/cases'
import { filterCases } from '../../../domain/inspiration/cases'
import {
  buildDesignResearchReport,
  extractOpenGraphImages,
  MAX_RESEARCH_URLS,
  normalizeResearchRequest,
  parsePinterestHtml,
  type DesignResearchItem,
  type DesignResearchReport,
  type ResearchProvider,
} from '../../../domain/inspiration/designResearch'
import type { NetworkPort } from '../../../platform/ports'
import { isPublicHttpUrl } from '../../../domain/shared/publicUrl'
import { errorTextOf } from '../../../shared/result'

export interface DesignResearchRunnerInput {
  topic: string
  urls?: readonly string[]
  maxResults?: number
}

export interface DesignResearchRunnerDeps {
  network: NetworkPort
  libraryCases?: readonly InspirationCase[]
}

export interface DesignResearchResult extends DesignResearchReport {
  ok: boolean
  warnings: string[]
}

function providerOf(url: string): ResearchProvider {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    if (host === 'pinterest.com' || host.endsWith('.pinterest.com')) return 'pinterest'
    if (host === 'behance.net' || host.endsWith('.behance.net')) return 'behance'
    if (host === 'google.com' || host.endsWith('.google.com')) return 'google'
    return 'web'
  } catch {
    return 'web'
  }
}

function pageTitle(html: string, pageUrl: string): string {
  const title =
    /<meta\b[^>]*\bproperty=["']og:title["'][^>]*\bcontent=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bproperty=["']og:title["']/i.exec(html)?.[1] ??
    /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ??
    ''
  const cleaned = title
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned) return cleaned
  try {
    const url = new URL(pageUrl)
    return decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? url.hostname)
  } catch {
    return pageUrl
  }
}

function itemId(source: ResearchProvider, pageUrl: string, imageUrl: string, index: number): string {
  let marker = ''
  try {
    const url = new URL(pageUrl)
    marker = `${url.pathname}${imageUrl ? `|${imageUrl}` : ''}`
  } catch {
    marker = `${pageUrl}|${imageUrl}`
  }
  let hash = 0x811c9dc5
  for (let i = 0; i < marker.length; i += 1) {
    hash ^= marker.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${source}:${(hash >>> 0).toString(36)}:${index}`
}

function pageItems(html: string, pageUrl: string): DesignResearchItem[] {
  const provider = providerOf(pageUrl)
  if (provider === 'pinterest') {
    const pins = parsePinterestHtml(html, pageUrl)
    if (pins.length > 0) {
      return pins.map((item) =>
        isPublicHttpUrl(item.imageUrl) ? item : { ...item, imageUrl: '' },
      )
    }
  }

  const title = pageTitle(html, pageUrl)
  const images = extractOpenGraphImages(html, pageUrl)
    .filter((imageUrl) => isPublicHttpUrl(imageUrl))
    .slice(0, 6)
  if (images.length > 0) {
    return images.map((imageUrl, index) => ({
      id: itemId(provider, pageUrl, imageUrl, index),
      source: provider,
      title,
      url: pageUrl,
      imageUrl,
    }))
  }

  return [
    {
      id: itemId(provider, pageUrl, '', 0),
      source: provider,
      title,
      url: pageUrl,
      imageUrl: '',
    },
  ]
}

function libraryItems(
  cases: readonly InspirationCase[],
  topic: string,
  limit: number,
): DesignResearchItem[] {
  return filterCases(cases, { query: topic })
    .slice(0, limit)
    .map((item, index) => ({
      id: `web:library:${item.id}:${index}`,
      source: 'web',
      title: item.title,
      url: item.creditUrl || item.docUrl || item.imageUrl || item.id,
      imageUrl: isPublicHttpUrl(item.imageUrl) ? item.imageUrl : '',
    }))
}

export async function runDesignResearch(
  input: DesignResearchRunnerInput,
  deps: DesignResearchRunnerDeps,
  signal: AbortSignal,
): Promise<DesignResearchResult> {
  const request = normalizeResearchRequest(input.topic, input.urls, input.maxResults)
  const warnings: string[] = []
  if ((input.urls?.length ?? 0) > MAX_RESEARCH_URLS) {
    warnings.push(`一次最多读取 ${MAX_RESEARCH_URLS} 个公开页面，多出的 URL 已忽略。`)
  }
  const safeUrls: string[] = []
  for (const url of request.urls) {
    if (isPublicHttpUrl(url)) safeUrls.push(url)
    else warnings.push(`${url} 不是公开互联网地址，已跳过。`)
  }
  const items = libraryItems(
    deps.libraryCases ?? [],
    request.topic,
    Math.min(request.maxResults, 12),
  )

  const pages = await Promise.allSettled(
    safeUrls.map(async (url) => {
      const response = await deps.network.request(
        {
          url,
          method: 'GET',
          headers: {
            Accept: 'text/html,application/xhtml+xml',
          },
          publicOnly: true,
          maxResponseBytes: 8 * 1024 * 1024,
          timeoutMs: 30_000,
        },
        signal,
      )
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}`)
      }
      const html = await response.text()
      if (html.length > 8 * 1024 * 1024) {
        throw new Error('公开页面超过 8MB，已跳过')
      }
      return pageItems(html, url)
    }),
  )

  for (const [index, result] of pages.entries()) {
    if (result.status === 'fulfilled') {
      items.push(...result.value)
    } else {
      warnings.push(
        `${safeUrls[index] ?? '公开页面'} 读取失败：${errorTextOf(result.reason)}`,
      )
    }
  }

  if (request.urls.length === 0) {
    warnings.push('没有提供公开页面 URL；本次只检索了轻画本地灵感库。')
  }
  if (items.length === 0) {
    warnings.push('没有找到可用参考。可以补充公开 Pinterest / Behance / 网页 URL 后重试。')
  }

  const report = buildDesignResearchReport({
    request: { ...request, urls: safeUrls },
    items,
  })
  return {
    ok: !signal.aborted && items.length > 0,
    ...report,
    warnings,
  }
}

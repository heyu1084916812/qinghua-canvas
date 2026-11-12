import { htmlToReadableText } from '../research/htmlReadableText'
import { decodeHtmlEntities, parseTagAttributes } from '../research/htmlText'

/**
 * 品牌官网 HTML → 套件候选（2026-11-12，对齐 Lovart「输入网址生成品牌套件」）。
 *
 * 只做字符串解析，不执行页面脚本；页面内容一律当数据：
 * - Logo 候选：og:image / twitter:image、apple-touch-icon、icon、以及 src / alt / class / id
 *   里带 logo 的 `<img>`；相对地址按页面地址补全，只留 http(s)。
 * - 主题色：`<meta name="theme-color">` 优先，其次 CSS 自定义属性里的十六进制色值，
 *   再按出现频次取 `<style>` 与 style 属性里的其余色值；纯黑白灰不算品牌色。
 * - 正文：复用 `htmlToReadableText`，供设计指南生成当资料。
 */

export type KitPageCandidateSource = 'og-image' | 'touch-icon' | 'icon' | 'logo-img' | 'img'

export interface KitPageCandidate {
  url: string
  source: KitPageCandidateSource
  label: string
}

export interface KitPageColor {
  hex: string
  label: string
}

export interface KitPageExtract {
  title: string
  text: string
  candidates: KitPageCandidate[]
  colors: KitPageColor[]
}

export const MAX_PAGE_CANDIDATES = 12
export const MAX_PAGE_COLORS = 6

const SOURCE_LABEL: Record<KitPageCandidateSource, string> = {
  'og-image': '分享图',
  'touch-icon': '应用图标',
  icon: '网站图标',
  'logo-img': '页面 Logo',
  img: '页面图片',
}

function absolute(raw: string, base: string): string {
  const value = decodeHtmlEntities(String(raw ?? '').trim())
  if (!value || value.startsWith('data:')) return ''
  try {
    const url = new URL(value, base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
}

function tags(html: string, name: string): Record<string, string>[] {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map((match) =>
    parseTagAttributes(match[1] ?? ''),
  )
}

function attr(row: Record<string, string>, key: string): string {
  return row[key] ?? row[key.toLowerCase()] ?? ''
}

export function extractPageCandidates(html: string, baseUrl: string): KitPageCandidate[] {
  const out: KitPageCandidate[] = []
  const seen = new Set<string>()
  const push = (raw: string, source: KitPageCandidateSource) => {
    const url = absolute(raw, baseUrl)
    if (!url || seen.has(url) || out.length >= MAX_PAGE_CANDIDATES) return
    seen.add(url)
    out.push({ url, source, label: SOURCE_LABEL[source] })
  }
  const metas = tags(html, 'meta')
  const links = tags(html, 'link')
  const images = tags(html, 'img')
  const logoImages = images.filter((row) =>
    /logo|brand|标志|商标/i.test(
      [attr(row, 'src'), attr(row, 'alt'), attr(row, 'class'), attr(row, 'id')].join(' '),
    ),
  )
  for (const row of logoImages) push(attr(row, 'src') || attr(row, 'data-src'), 'logo-img')
  for (const row of links) {
    const rel = attr(row, 'rel').toLowerCase()
    if (rel.includes('apple-touch-icon')) push(attr(row, 'href'), 'touch-icon')
  }
  for (const row of metas) {
    const key = (attr(row, 'property') || attr(row, 'name')).toLowerCase()
    if (key === 'og:image' || key === 'og:image:url' || key === 'twitter:image') {
      push(attr(row, 'content'), 'og-image')
    }
  }
  for (const row of links) {
    const rel = attr(row, 'rel').toLowerCase().split(/\s+/)
    if (rel.includes('icon') || rel.includes('mask-icon')) push(attr(row, 'href'), 'icon')
  }
  for (const row of images) {
    if (logoImages.includes(row)) continue
    push(attr(row, 'src') || attr(row, 'data-src'), 'img')
  }
  return out
}

function normalizeHex(raw: string): string {
  const value = raw.replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{3}$/.test(value)) return `#${[...value].map((c) => c + c).join('')}`.toUpperCase()
  if (/^[0-9a-f]{6}$/.test(value)) return `#${value}`.toUpperCase()
  if (/^[0-9a-f]{8}$/.test(value)) return `#${value.slice(0, 6)}`.toUpperCase()
  return ''
}

/** 近黑 / 近白 / 灰（饱和度极低）不当品牌色。 */
function isNeutral(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return Math.max(r, g, b) - Math.min(r, g, b) < 18
}

export function extractPageColors(html: string): KitPageColor[] {
  const out: KitPageColor[] = []
  const seen = new Set<string>()
  const push = (raw: string, label: string, allowNeutral = false) => {
    const hex = normalizeHex(raw)
    if (!hex || seen.has(hex) || out.length >= MAX_PAGE_COLORS) return
    if (!allowNeutral && isNeutral(hex)) return
    seen.add(hex)
    out.push({ hex, label })
  }
  for (const row of tags(html, 'meta')) {
    if ((attr(row, 'name') || '').toLowerCase() === 'theme-color') {
      push(attr(row, 'content'), '网页主题色', true)
    }
  }
  const styleText = [
    ...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((match) => match[1] ?? ''),
    ...[...html.matchAll(/\bstyle=["']([^"']*)["']/gi)].map((match) => match[1] ?? ''),
  ].join('\n')
  for (const match of styleText.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-f]{3,8})\b/gi)) {
    push(match[2] ?? '', `变量 --${match[1]}`)
  }
  const counts = new Map<string, number>()
  for (const match of styleText.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    const hex = normalizeHex(match[0])
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  for (const [hex] of [...counts].sort((left, right) => right[1] - left[1])) {
    push(hex, '页面常用色')
  }
  return out
}

export function extractKitPage(html: string, baseUrl: string): KitPageExtract {
  const readable = htmlToReadableText(html)
  return {
    title: readable.title,
    text: readable.text,
    candidates: extractPageCandidates(html, baseUrl),
    colors: extractPageColors(html),
  }
}

/**
 * 品牌手册 PDF 导入（2026-11-12）：把 PDF 前若干页渲染成图片候选，并抽出正文文字。
 *
 * - 只在本地解析，不上传；渲染与文字抽取由 `KitPdfEngine` 完成（默认懒加载 pdfjs 适配器，
 *   测试注入假引擎）。
 * - 页图由用户在候选面板勾选后作为参考素材加入；文字只作为「根据素材生成指南」的资料，
 *   不写进套件版本（与网页正文同一条通道）。
 */

export const KIT_PDF_MAX_BYTES = 20 * 1024 * 1024
/** 最多读取的页数：品牌手册常见 20–80 页，前 20 页通常已覆盖封面 / Logo / 色彩 / 字体。 */
export const KIT_PDF_MAX_PAGES = 20
/** 渲染页图的长边像素：够模型看清版式，又不至于让每页参考图过大。 */
export const KIT_PDF_PAGE_EDGE = 1600
/** 抽出文字的上限（生成指南时还会再按预算截断）。 */
export const KIT_PDF_TEXT_MAX_CHARS = 40_000

export interface KitPdfEnginePage {
  /** 本页文字（按行拼接）。 */
  text(): Promise<string>
  /** 渲染成图片，长边不超过 maxEdge。 */
  render(maxEdge: number): Promise<{ blob: Blob; width: number; height: number }>
}

export interface KitPdfEngineDocument {
  numPages: number
  getPage(pageNumber: number): Promise<KitPdfEnginePage>
  destroy(): Promise<void> | void
}

export interface KitPdfEngine {
  open(bytes: Uint8Array): Promise<KitPdfEngineDocument>
}

export interface KitPdfPage {
  /** 从 1 开始的页码。 */
  pageNumber: number
  blob: Blob
  width: number
  height: number
}

export interface KitPdfExtract {
  name: string
  pageCount: number
  pages: KitPdfPage[]
  /** 渲染失败的页码（如个别页损坏），如实告知。 */
  failedPages: number[]
  text: string
}

export interface ReadKitPdfOptions {
  signal?: AbortSignal
  maxPages?: number
  pageEdge?: number
  engine?: KitPdfEngine
  onProgress?(done: number, total: number): void
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-

export function isPdfFile(file: { name: string; type: string }): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

/** 魔数可能前置少量垃圾字节（规范允许 1024 内），只在开头 1KB 里找。 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - PDF_MAGIC.length, 1024)
  for (let start = 0; start <= limit; start += 1) {
    if (PDF_MAGIC.every((byte, index) => bytes[start + index] === byte)) return true
  }
  return false
}

function abortError(): Error {
  return Object.assign(new Error('已取消读取 PDF'), { name: 'AbortError' })
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError()
}

/** pdfjs 的异常名映射成给人看的中文；未知错误保留原文（不含任何密钥）。 */
export function describePdfError(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  if (name === 'PasswordException' || /password/i.test(message)) return '这个 PDF 有密码保护，暂不支持导入'
  if (name === 'InvalidPDFException' || /invalid pdf/i.test(message)) return '文件不是有效的 PDF，或已损坏'
  return `读取 PDF 失败：${message || '未知错误'}`
}

export function normalizePdfText(pages: readonly string[], maxChars = KIT_PDF_TEXT_MAX_CHARS): string {
  const joined = pages
    .map((text, index) => {
      const clean = text.replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
      return clean ? `【第 ${index + 1} 页】\n${clean}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
  return joined.length > maxChars ? joined.slice(0, maxChars) : joined
}

async function defaultEngine(): Promise<KitPdfEngine> {
  const { createPdfjsEngine } = await import('./kitPdfEngine')
  return createPdfjsEngine()
}

export async function readKitPdf(file: File, options: ReadKitPdfOptions = {}): Promise<KitPdfExtract> {
  const { signal, maxPages = KIT_PDF_MAX_PAGES, pageEdge = KIT_PDF_PAGE_EDGE, onProgress } = options
  if (file.size > KIT_PDF_MAX_BYTES) throw new Error(`${file.name || 'PDF'}超过 20MB`)
  if (file.size === 0) throw new Error(`${file.name || 'PDF'}没有内容`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!looksLikePdf(bytes)) throw new Error('文件不是有效的 PDF，或已损坏')
  throwIfAborted(signal)
  const engine = options.engine ?? (await defaultEngine())
  let doc: KitPdfEngineDocument
  try {
    doc = await engine.open(bytes)
  } catch (error) {
    throw new Error(describePdfError(error))
  }
  try {
    const total = Math.min(doc.numPages, Math.max(1, maxPages))
    const pages: KitPdfPage[] = []
    const failedPages: number[] = []
    const texts: string[] = []
    onProgress?.(0, total)
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      throwIfAborted(signal)
      try {
        const page = await doc.getPage(pageNumber)
        texts.push(await page.text().catch(() => ''))
        throwIfAborted(signal)
        const rendered = await page.render(pageEdge)
        pages.push({ pageNumber, ...rendered })
      } catch {
        if (signal?.aborted) throw abortError()
        if (texts.length < pageNumber) texts.push('')
        failedPages.push(pageNumber)
      }
      onProgress?.(pageNumber, total)
    }
    if (pages.length === 0 && !texts.some((text) => text.trim())) {
      throw new Error('PDF 里没有可读取的页面')
    }
    return { name: file.name, pageCount: doc.numPages, pages, failedPages, text: normalizePdfText(texts) }
  } finally {
    await doc.destroy()
  }
}

/** 页图文件名：`手册名-p03.jpg`，便于在素材里认出来源页。 */
export function pdfPageFileName(pdfName: string, pageNumber: number, mime: string): string {
  const base = pdfName.replace(/\.pdf$/i, '').trim() || 'PDF'
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  return `${base}-p${String(pageNumber).padStart(2, '0')}.${ext}`
}

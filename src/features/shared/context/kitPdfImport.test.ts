import { describe, expect, it, vi } from 'vitest'
import {
  KIT_PDF_MAX_BYTES,
  describePdfError,
  isPdfFile,
  looksLikePdf,
  normalizePdfText,
  pdfPageFileName,
  readKitPdf,
  type KitPdfEngine,
} from './kitPdfImport'

const PDF_HEAD = new TextEncoder().encode('%PDF-1.7\n%âãÏÓ\n')

function pdfFile(name = '品牌手册.pdf', bytes: Uint8Array = PDF_HEAD) {
  return new File([bytes as BlobPart], name, { type: 'application/pdf' })
}

function fakeEngine(numPages: number, opts: { failRender?: number[]; texts?: string[] } = {}) {
  const destroy = vi.fn()
  const getPage = vi.fn(async (pageNumber: number) => ({
    text: async () => opts.texts?.[pageNumber - 1] ?? `第${pageNumber}页文字`,
    render: async (maxEdge: number) => {
      if (opts.failRender?.includes(pageNumber)) throw new Error('bad page')
      return { blob: new Blob([String(pageNumber)], { type: 'image/jpeg' }), width: maxEdge, height: 100 }
    },
  }))
  const engine: KitPdfEngine = { open: vi.fn(async () => ({ numPages, getPage, destroy })) }
  return { engine, getPage, destroy }
}

describe('kitPdfImport', () => {
  it('按 mime 或扩展名识别 PDF；魔数只在开头 1KB 内找', () => {
    expect(isPdfFile({ name: 'a.PDF', type: '' })).toBe(true)
    expect(isPdfFile({ name: 'a', type: 'application/pdf' })).toBe(true)
    expect(isPdfFile({ name: 'a.png', type: 'image/png' })).toBe(false)
    expect(looksLikePdf(PDF_HEAD)).toBe(true)
    const junk = new Uint8Array(2000)
    junk.set(PDF_HEAD, 10)
    expect(looksLikePdf(junk)).toBe(true)
    const late = new Uint8Array(3000)
    late.set(PDF_HEAD, 1500)
    expect(looksLikePdf(late)).toBe(false)
  })

  it('超过 20MB、空文件、非 PDF 内容直接拒绝，不加载引擎', async () => {
    const { engine } = fakeEngine(1)
    const huge = new File([new Uint8Array(KIT_PDF_MAX_BYTES + 1) as BlobPart], 'big.pdf')
    await expect(readKitPdf(huge, { engine })).rejects.toThrow('超过 20MB')
    await expect(readKitPdf(new File([], 'e.pdf'), { engine })).rejects.toThrow('没有内容')
    await expect(readKitPdf(pdfFile('x.pdf', new TextEncoder().encode('<html>')), { engine })).rejects.toThrow('不是有效的 PDF')
    expect(engine.open).not.toHaveBeenCalled()
  })

  it('只读前 maxPages 页：逐页渲染 + 抽字，汇报进度，结束后销毁文档', async () => {
    const { engine, getPage, destroy } = fakeEngine(30)
    const progress: string[] = []
    const result = await readKitPdf(pdfFile(), {
      engine,
      maxPages: 20,
      pageEdge: 800,
      onProgress: (done, total) => progress.push(`${done}/${total}`),
    })
    expect(result.pageCount).toBe(30)
    expect(result.pages).toHaveLength(20)
    expect(result.pages[0]).toMatchObject({ pageNumber: 1, width: 800 })
    expect(getPage).toHaveBeenCalledTimes(20)
    expect(progress[0]).toBe('0/20')
    expect(progress.at(-1)).toBe('20/20')
    expect(result.text).toContain('【第 1 页】\n第1页文字')
    expect(result.text).not.toContain('第21页')
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('个别页渲染失败时如实列出，其余页照常返回', async () => {
    const { engine } = fakeEngine(3, { failRender: [2] })
    const result = await readKitPdf(pdfFile(), { engine })
    expect(result.pages.map((page) => page.pageNumber)).toEqual([1, 3])
    expect(result.failedPages).toEqual([2])
  })

  it('取消后停止渲染、抛 AbortError，并仍销毁文档', async () => {
    const { engine, getPage, destroy } = fakeEngine(10)
    const controller = new AbortController()
    const run = readKitPdf(pdfFile(), {
      engine,
      signal: controller.signal,
      onProgress: (done) => {
        if (done === 2) controller.abort()
      },
    })
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(getPage).toHaveBeenCalledTimes(2)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('打开失败：密码 / 损坏转成中文提示', async () => {
    const engine: KitPdfEngine = {
      open: async () => {
        throw Object.assign(new Error('No password given'), { name: 'PasswordException' })
      },
    }
    await expect(readKitPdf(pdfFile(), { engine })).rejects.toThrow('密码保护')
    expect(describePdfError(Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' }))).toContain('不是有效的 PDF')
  })

  it('没有页图也没有文字时报错', async () => {
    const { engine } = fakeEngine(1, { failRender: [1], texts: ['  '] })
    await expect(readKitPdf(pdfFile(), { engine })).rejects.toThrow('没有可读取的页面')
  })

  it('文字整理：压空白、标页码、跳过空页、按上限截断', () => {
    expect(normalizePdfText(['a   b\n\n\n\nc', '', ' d '])).toBe('【第 1 页】\na b\n\nc\n\n【第 3 页】\nd')
    expect(normalizePdfText(['x'.repeat(100)], 20)).toHaveLength(20)
  })

  it('页图文件名带来源页码', () => {
    expect(pdfPageFileName('Anbel 手册.pdf', 3, 'image/jpeg')).toBe('Anbel 手册-p03.jpg')
    expect(pdfPageFileName('.pdf', 12, 'image/png')).toBe('PDF-p12.png')
  })
})

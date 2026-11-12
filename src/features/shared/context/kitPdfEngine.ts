/**
 * pdfjs-dist 适配器（只在浏览器 / WebView 里懒加载，2026-11-12）。
 *
 * 为什么这样接 pdfjs：
 * - worker 用 `?url` 交给 Vite 当静态资源输出，同源加载，满足 Tauri CSP 的 `worker-src 'self' blob:`。
 * - CMap / 标准字体 / wasm 用 `import.meta.glob(..., { query: '?url' })` 输出为同源静态资源，
 *   再由自定义 BinaryDataFactory 在主线程按文件名取（Vite 会给文件名加哈希，不能用目录前缀 URL）。
 *   中文品牌手册常用未嵌入的 CJK 字体，缺 CMap 时文字会乱码或丢失。
 * - pdfjs v5 已不再用 eval / new Function 编译字体，CSP 无需 `unsafe-eval`；wasm 解码器靠现有的
 *   `script-src 'wasm-unsafe-eval'`，缺失时 pdfjs 自带 JS 兜底。
 */
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { KitPdfEngine, KitPdfEngineDocument } from './kitPdfImport'

// glob 选项必须写成字面量：Vite 只做静态分析，传变量会被当成无 query 的源码导入。
const CMAP_URLS = import.meta.glob('/node_modules/pdfjs-dist/cmaps/*.bcmap', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>
const FONT_URLS = import.meta.glob(
  ['/node_modules/pdfjs-dist/standard_fonts/*.pfb', '/node_modules/pdfjs-dist/standard_fonts/*.ttf'],
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>
const WASM_URLS = import.meta.glob(
  // quickjs-eval.wasm 只服务 PDF 内嵌脚本，套件导入用不到，不打包
  ['/node_modules/pdfjs-dist/wasm/jbig2.wasm', '/node_modules/pdfjs-dist/wasm/openjpeg.wasm', '/node_modules/pdfjs-dist/wasm/qcms_bg.wasm'],
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>

function byFileName(urls: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(urls).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]))
}

const BINARY_URLS: Record<string, Map<string, string>> = {
  cMapUrl: byFileName(CMAP_URLS),
  standardFontDataUrl: byFileName(FONT_URLS),
  wasmUrl: byFileName(WASM_URLS),
}

/** pdfjs 的 BinaryDataFactory 协议：`fetch({ kind, filename })` 返回字节。 */
class BundledBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = BINARY_URLS[kind]?.get(filename)
    if (!url) throw new Error(`pdfjs 资源缺失：${kind}/${filename}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`pdfjs 资源读取失败：${filename}（HTTP ${response.status}）`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('页面转图片失败'))), 'image/jpeg', 0.9)
  })
}

function wrap(doc: PDFDocumentProxy): KitPdfEngineDocument {
  return {
    numPages: doc.numPages,
    async getPage(pageNumber) {
      const page = await doc.getPage(pageNumber)
      return {
        async text() {
          const content = await page.getTextContent()
          let out = ''
          for (const item of content.items) {
            if (!('str' in item)) continue
            out += item.str
            if (item.hasEOL) out += '\n'
          }
          return out
        },
        async render(maxEdge) {
          const base = page.getViewport({ scale: 1 })
          const scale = Math.min(4, maxEdge / Math.max(base.width, base.height))
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(viewport.width))
          canvas.height = Math.max(1, Math.round(viewport.height))
          try {
            await page.render({ canvas, viewport, background: '#ffffff' }).promise
            const blob = await canvasToBlob(canvas)
            return { blob, width: canvas.width, height: canvas.height }
          } finally {
            canvas.width = 0
            canvas.height = 0
            page.cleanup()
          }
        },
      }
    },
    async destroy() {
      await doc.destroy()
    },
  }
}

export function createPdfjsEngine(): KitPdfEngine {
  if (GlobalWorkerOptions.workerSrc !== workerUrl) GlobalWorkerOptions.workerSrc = workerUrl
  return {
    async open(bytes) {
      const task = getDocument({
        data: bytes,
        BinaryDataFactory: BundledBinaryDataFactory,
        useWorkerFetch: false,
        cMapPacked: true,
        enableXfa: false,
        stopAtErrors: false,
      })
      return wrap(await task.promise)
    },
  }
}

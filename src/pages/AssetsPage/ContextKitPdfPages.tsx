import { useEffect, useState } from 'react'
import { KIT_PDF_MAX_PAGES, type KitPdfExtract, type KitPdfPage } from '../../features/shared/context/kitPdfImport'
import importStyles from './ContextKitsImport.module.css'

const styles = importStyles as Record<string, string>

/** 默认勾选的页数：与「根据素材生成指南」一次最多看 8 张图对齐，其余页由用户自己勾。 */
export const PDF_DEFAULT_PICKED_PAGES = 8

export interface ContextKitPdfPagesProps {
  pdf: KitPdfExtract
  busy: boolean
  onCancel(): void
  onAdd(picked: { pages: KitPdfPage[]; text: string }): void
}

export function defaultPickedPages(pdf: Pick<KitPdfExtract, 'pages'>): Set<number> {
  return new Set(pdf.pages.slice(0, PDF_DEFAULT_PICKED_PAGES).map((page) => page.pageNumber))
}

/**
 * PDF 品牌手册导入后的选页面板：页图本地预览、勾选要作为参考素材的页，
 * 正文文字可选作生成设计指南的资料（不写进套件版本）。
 */
export function ContextKitPdfPages({ pdf, busy, onCancel, onAdd }: ContextKitPdfPagesProps) {
  const [picked, setPicked] = useState<Set<number>>(() => defaultPickedPages(pdf))
  const [useText, setUseText] = useState(pdf.text.trim().length > 0)
  const [sources, setSources] = useState<Map<number, string>>(new Map())
  useEffect(() => {
    const next = new Map(pdf.pages.map((page) => [page.pageNumber, URL.createObjectURL(page.blob)]))
    setSources(next)
    return () => {
      for (const src of next.values()) URL.revokeObjectURL(src)
    }
  }, [pdf])

  const allOn = picked.size === pdf.pages.length && pdf.pages.length > 0
  const toggle = (pageNumber: number) => {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(pageNumber)) next.delete(pageNumber)
      else next.add(pageNumber)
      return next
    })
  }
  const notes = [
    pdf.pageCount > KIT_PDF_MAX_PAGES ? `共 ${pdf.pageCount} 页，只读取前 ${KIT_PDF_MAX_PAGES} 页` : `共 ${pdf.pageCount} 页`,
    pdf.failedPages.length ? `第 ${pdf.failedPages.join('、')} 页渲染失败` : '',
  ].filter(Boolean)

  return (
    <div className={styles.webPanel} data-context-pdf-pages>
      <div className={styles.webHead}>
        <strong title={pdf.name}>{pdf.name}</strong>
        <span>{notes.join('；')}</span>
        {pdf.pages.length > 0 ? (
          <button
            type="button"
            className={styles.pdfSelectAll}
            data-context-pdf-select-all
            onClick={() => setPicked(allOn ? new Set() : new Set(pdf.pages.map((page) => page.pageNumber)))}
          >
            {allOn ? '全不选' : '全选'}
          </button>
        ) : null}
      </div>
      {pdf.pages.length > 0 ? (
        <div className={styles.webGrid}>
          {pdf.pages.map((page) => {
            const on = picked.has(page.pageNumber)
            return (
              <button
                key={page.pageNumber}
                type="button"
                className={on ? styles.webTileOn : styles.webTile}
                aria-pressed={on}
                data-context-pdf-page={page.pageNumber}
                onClick={() => toggle(page.pageNumber)}
              >
                <span className={styles.webThumb}>
                  <img src={sources.get(page.pageNumber)} alt={`第 ${page.pageNumber} 页`} />
                </span>
                <span className={styles.webTileLabel}>第 {page.pageNumber} 页 · 参考</span>
              </button>
            )
          })}
        </div>
      ) : (
        <p className={styles.webEmpty}>没有成功渲染的页面</p>
      )}
      {pdf.text.trim() ? (
        <label className={styles.webText}>
          <input type="checkbox" checked={useText} onChange={(event) => setUseText(event.target.checked)} />
          <span>把 PDF 文字（{pdf.text.length} 字）作为生成设计指南的资料</span>
        </label>
      ) : (
        <p className={styles.webEmpty}>没有抽出文字（可能是扫描件），仍可勾选页图</p>
      )}
      <div className={styles.webActions}>
        <button type="button" className={styles.guideNoticeQuiet} onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className={styles.guideNoticeAction}
          disabled={busy || (picked.size === 0 && !useText)}
          data-context-pdf-add
          onClick={() => onAdd({
            pages: pdf.pages.filter((page) => picked.has(page.pageNumber)),
            text: useText ? pdf.text : '',
          })}
        >
          加入套件{picked.size > 0 ? `（${picked.size} 页）` : ''}
        </button>
      </div>
    </div>
  )
}

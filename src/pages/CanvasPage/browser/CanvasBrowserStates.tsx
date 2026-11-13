import { ExternalLink, Icon, RotateCw, TriangleAlert } from '../../../ui/icon'
import { BROWSER_QUICK_SITES } from './browserQuickSites'
import styles from './CanvasBrowserStates.module.css'

/** 起始页：没有打开任何网页时显示设计站点快捷入口 */
export function CanvasBrowserStartPage({ onOpen }: { onOpen: (url: string) => void }) {
  return (
    <div className={styles.start} data-canvas-browser-start>
      <div className={styles.startInner}>
        <h2 className={styles.title}>找参考</h2>
        <p className={styles.hint}>在地址栏输入网址，或从常用设计站点开始。</p>
        <ul className={styles.quickGrid}>
          {BROWSER_QUICK_SITES.map((site) => (
            <li key={site.domain}>
              <button
                type="button"
                className={styles.quick}
                data-canvas-browser-quick={site.domain}
                onClick={() => onOpen(site.url)}
              >
                <span className={styles.mark} aria-hidden="true">{site.mark}</span>
                <span className={styles.quickText}>
                  <span className={styles.quickLabel}>{site.label}</span>
                  <span className={styles.quickDomain}>{site.domain}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** 错误态：网页打不开 / 不允许嵌入 / 超时 */
export function CanvasBrowserError({
  message,
  onRetry,
  onOpenExternal,
}: {
  message: string
  onRetry: () => void
  onOpenExternal: () => void
}) {
  return (
    <div className={styles.error} role="alert" data-canvas-browser-error>
      <span className={styles.errorIcon}>
        <Icon icon={TriangleAlert} size="lg" />
      </span>
      <h2 className={styles.title}>这个网页没能打开</h2>
      <p className={styles.hint}>{message}</p>
      <div className={styles.errorActions}>
        <button type="button" className={styles.primary} onClick={onRetry}>
          <Icon icon={RotateCw} size="sm" />
          重试
        </button>
        <button type="button" className={styles.secondary} onClick={onOpenExternal}>
          <Icon icon={ExternalLink} size="sm" />
          在系统浏览器打开
        </button>
      </div>
    </div>
  )
}

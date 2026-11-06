import type { ReactNode } from 'react'
import type { EcommerceUsage } from '../../../domain/ecommerce/types'
import { styles } from './studioStyles'
import { ResultStatusOverlay } from './EcommerceStudioStatusViews'
import {
  STUDIO_MODES,
  type EcommerceResultItem,
  type EcommerceUpload,
  type StudioMode,
} from './studioContracts'
import type { StudioCarouselCase } from './controller/studioFormProjection'

export function EcommerceStudioResultsPane({
  mode,
  usage,
  categoryModes,
  products,
  workbench,
  visibleResults,
  carouselCases,
  longImageNode,
  running,
  onActivateMode,
}: {
  mode: StudioMode
  usage: EcommerceUsage
  categoryModes: readonly StudioMode[]
  products: readonly EcommerceUpload[]
  workbench?: ReactNode
  visibleResults: readonly EcommerceResultItem[]
  carouselCases: readonly StudioCarouselCase[]
  longImageNode?: ReactNode
  running: boolean
  onActivateMode: (mode: StudioMode) => void
}) {
  return (
    <section className={styles.results} data-ecommerce-results>
      <nav className={styles.modeBar} data-ecommerce-modes>
        {categoryModes.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              item.id === mode.id
                ? `${styles.modeButton} ${styles.modeButtonOn}`
                : styles.modeButton
            }
            data-ecommerce-mode={item.id}
            {...(STUDIO_MODES.find(
              (candidate) =>
                candidate.category === item.category && candidate.usage === item.usage,
            )?.id === item.id
              ? { 'data-ecommerce-usage': item.usage }
              : {})}
            aria-pressed={item.id === mode.id}
            aria-checked={item.usage === usage}
            onClick={() => onActivateMode(item)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {workbench ?? (visibleResults.length === 0 ? (
        <div className={styles.caseSection} data-ecommerce-empty>
          <div className={styles.carousel} data-ecommerce-case-carousel>
            {carouselCases.map((item, index) => (
              <article className={styles.caseCard} key={item.id}>
                <header className={styles.caseHead}>
                  <span className={styles.caseTitle}>{item.title}</span>
                  <span className={styles.caseTag}>{item.tag}</span>
                </header>
                <div className={styles.caseBody}>
                  <div className={styles.caseSource}>
                    {index === 0 && products[0]?.preview ? (
                      products[0].preview
                    ) : (
                      <span>{mode.mediaKind === 'video' ? '视频' : '商品'}</span>
                    )}
                  </div>
                  <span className={styles.caseArrow}>→</span>
                  <div className={styles.caseResults}>
                    {item.tiles.map((tile) => (
                      <span key={tile}>{tile}</span>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.grid} data-ecommerce-grid>
          {visibleResults.map((result) => (
            <figure
              key={result.nodeId}
              className={styles.cell}
              data-ecommerce-result
              data-ecommerce-result-id={result.nodeId}
              data-status={result.status}
            >
              <div className={styles.cellBody}>
                {result.preview ?? (
                  result.status === 'done' ? (
                    <span className={styles.cellState}>已完成</span>
                  ) : null
                )}
                {result.status === 'running' || result.status === 'failed' ? (
                  <ResultStatusOverlay item={result} />
                ) : null}
              </div>
              {result.status === 'failed' ? (
                <figcaption className={styles.cellFoot}>
                  <span className={styles.cellError}>
                    {result.error ?? '失败（没有原因记录）'}
                  </span>
                  {result.recovery === 'retry-save' && result.onRetrySave ? (
                    <button
                      type="button"
                      className={styles.cellRetry}
                      data-ecommerce-retry-save={result.nodeId}
                      disabled={running}
                      onClick={() => void result.onRetrySave?.()}
                    >
                      重试保存
                    </button>
                  ) : result.onRerun ? (
                    <button
                      type="button"
                      className={styles.cellRetry}
                      data-ecommerce-retry-result={result.nodeId}
                      disabled={running}
                      onClick={() => void result.onRerun?.()}
                    >
                      重新生成
                    </button>
                  ) : null}
                  {result.onRemoveFailed ? (
                    <button
                      type="button"
                      className={styles.cellRemove}
                      data-ecommerce-remove-failed={result.nodeId}
                      onClick={result.onRemoveFailed}
                    >
                      移除
                    </button>
                  ) : null}
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      ))}
      {longImageNode}
    </section>
  )
}

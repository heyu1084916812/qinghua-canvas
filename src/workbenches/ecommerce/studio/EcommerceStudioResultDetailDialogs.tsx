import { ecommerceRatioLabel } from '../../../domain/ecommerce/types'
import { styles } from './studioStyles'
import type { EcommerceResultItem } from './studioContracts'

export function EcommerceStudioResultDetailDialogs({
  detailTarget,
  compareTarget,
  onCloseDetail,
  onCopyPrompt,
  onCloseCompare,
}: {
  detailTarget: EcommerceResultItem | null
  compareTarget: EcommerceResultItem | null
  onCloseDetail: () => void
  onCopyPrompt: (prompt: string) => void
  onCloseCompare: () => void
}) {
  return (
    <>
      {detailTarget ? (
        <div
          className={styles.confirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ecommerce-result-detail-title"
          data-ecommerce-result-detail-dialog
        >
          <div className={styles.confirmCard}>
            <h2 className={styles.confirmTitle} id="ecommerce-result-detail-title">
              结果详情
            </h2>
            <dl className={styles.detailGrid}>
              {detailTarget.model ? (
                <>
                  <dt>模型</dt>
                  <dd>{detailTarget.model}</dd>
                </>
              ) : null}
              {detailTarget.shotTitle ? (
                <>
                  <dt>图片类型</dt>
                  <dd>{detailTarget.shotTitle}</dd>
                </>
              ) : null}
              {detailTarget.ratio ? (
                <>
                  <dt>比例</dt>
                  <dd>{ecommerceRatioLabel(detailTarget.ratio)}</dd>
                </>
              ) : null}
              {detailTarget.headline ? (
                <>
                  <dt>画面主文案</dt>
                  <dd>{detailTarget.headline}</dd>
                </>
              ) : null}
              {detailTarget.visualSystem ? (
                <>
                  <dt>视觉系统</dt>
                  <dd>{detailTarget.visualSystem}</dd>
                </>
              ) : null}
              {detailTarget.createdAt ? (
                <>
                  <dt>生成时间</dt>
                  <dd>{new Date(detailTarget.createdAt).toLocaleString('zh-CN')}</dd>
                </>
              ) : null}
              {detailTarget.note ? (
                <>
                  <dt>任务要求</dt>
                  <dd>{detailTarget.note}</dd>
                </>
              ) : null}
            </dl>
            {detailTarget.prompt ? (
              <pre className={styles.detailPrompt} data-ecommerce-result-prompt>
                {detailTarget.prompt}
              </pre>
            ) : null}
            <div className={styles.confirmActions}>
              {detailTarget.prompt ? (
                <button
                  type="button"
                  className={styles.cancel}
                  data-ecommerce-result-prompt-copy
                  onClick={() => onCopyPrompt(detailTarget.prompt ?? '')}
                >
                  复制提示词
                </button>
              ) : null}
              <button
                type="button"
                className={styles.cancel}
                data-ecommerce-result-detail-close
                onClick={onCloseDetail}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {compareTarget ? (
        <div
          className={styles.confirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ecommerce-compare-title"
          data-ecommerce-compare-dialog
        >
          <div className={`${styles.confirmCard} ${styles.compareCard}`}>
            <h2 className={styles.confirmTitle} id="ecommerce-compare-title">
              编辑前后对比
            </h2>
            <div className={styles.compareGrid}>
              <figure className={styles.comparePane}>
                <figcaption>原图</figcaption>
                <div className={styles.compareImage} data-ecommerce-compare-source-image>
                  {compareTarget.sourcePreview}
                </div>
              </figure>
              <figure className={styles.comparePane}>
                <figcaption>编辑结果</figcaption>
                <div className={styles.compareImage} data-ecommerce-compare-result-image>
                  {compareTarget.preview}
                </div>
              </figure>
            </div>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.cancel}
                data-ecommerce-compare-close
                onClick={onCloseCompare}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

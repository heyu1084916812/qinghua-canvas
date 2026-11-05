import { useEffect, useState } from 'react'
import type { EcommerceGenerationStage } from '../../../domain/ecommerce/progress'
import type { EcommerceResultItem } from './studioContracts'
import { styles } from './studioStyles'

export function ResultStatusOverlay({ item }: { item: EcommerceResultItem }) {
  const running = item.status === 'running'
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!running) {
      setElapsed(0)
      return
    }
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    return () => window.clearInterval(timer)
  }, [running])

  if (item.status === 'failed') {
    const retrySave = item.recovery === 'retry-save'
    return (
      <div
        className={`${styles.resultOverlay} ${styles.resultOverlayError}`}
        data-ecommerce-result-overlay={retrySave ? 'retry-save' : 'failed'}
        role="alert"
      >
        <span className={styles.resultFailure}>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5v5.5" />
            <path d="M12 16.8h.01" />
          </svg>
          <span className={styles.resultFailureTitle}>
            {retrySave ? '已生成，待保存' : '生成失败'}
          </span>
          <span
            className={styles.resultFailureText}
            data-ecommerce-result-error
            title={item.error}
          >
            {retrySave
              ? item.error ?? '素材没有保存成功，可点“重试保存”重新写入本地库。'
              : item.error ?? '没有收到失败原因，请查看画布运行日志'}
          </span>
        </span>
      </div>
    )
  }

  return (
    <div
      className={styles.resultOverlay}
      data-ecommerce-result-overlay={item.status}
    >
      <span className={styles.resultRunning}>
        <span
          className={styles.resultOrbit}
          data-ecommerce-result-orbit
          aria-hidden="true"
        />
        <span
          className={styles.resultRunningText}
          data-ecommerce-result-elapsed={elapsed}
        >
          生成中 {elapsed}s
        </span>
      </span>
    </div>
  )
}

export function GenerationStageView({ stage }: { stage: EcommerceGenerationStage | null }) {
  if (!stage) return null
  return (
    <div
      className={styles.generationStage}
      data-ecommerce-generation-stage={stage.phase}
      data-current={stage.current}
      data-total={stage.total}
      role={stage.phase === 'failed' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span className={styles.generationStageDot} aria-hidden="true" />
      <span className={styles.generationStageCopy}>
        <strong>{stage.label}</strong>
        {stage.detail ? <span title={stage.detail}>{stage.detail}</span> : null}
      </span>
      {stage.total ? (
        <span className={styles.generationStageCount}>
          {stage.current ?? 0}/{stage.total}
        </span>
      ) : null}
    </div>
  )
}

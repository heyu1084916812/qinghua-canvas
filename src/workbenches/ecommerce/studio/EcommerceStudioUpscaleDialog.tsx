import { ECOMMERCE_UPSCALE_SCALES } from '../../../domain/ecommerce/upscale'
import type { EcommerceUpscaleScale } from '../../../domain/ecommerce/upscale'
import { styles } from './studioStyles'
import type { StudioUpscaleTarget } from './controller/studioActionCoordinator'
import type { availableStudioUpscaleOptions } from './controller/studioResultActionCoordinator'

export function EcommerceStudioUpscaleDialog({
  upscaleTarget,
  availableUpscaleOptions,
  upscaleProfile,
  upscaleScale,
  upscaleError,
  upscaleSubmitting,
  running,
  onProfileChange,
  onScaleChange,
  onCancel,
  onSubmit,
}: {
  upscaleTarget: StudioUpscaleTarget | null
  availableUpscaleOptions: ReturnType<typeof availableStudioUpscaleOptions>
  upscaleProfile: string
  upscaleScale: EcommerceUpscaleScale
  upscaleError: string
  upscaleSubmitting: boolean
  running: boolean
  onProfileChange: (profile: ReturnType<typeof availableStudioUpscaleOptions>[number]['id']) => void
  onScaleChange: (scale: EcommerceUpscaleScale) => void
  onCancel: () => void
  onSubmit: () => Promise<void>
}) {
  if (!upscaleTarget) return null
  return (
    <div
      className={styles.confirm}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ecommerce-upscale-title"
      data-ecommerce-upscale-dialog
    >
      <div className={styles.confirmCard}>
        <h2 className={styles.confirmTitle} id="ecommerce-upscale-title">
          AI 超清
        </h2>
        <p className={styles.confirmText}>
          使用真实 Topaz 超分模型放大
          {upscaleTarget.items.length > 1
            ? `所选 ${upscaleTarget.items.length} 张结果`
            : '这张结果'}
          ，不重绘商品也不生成新画面。原图和原任务都会保留；会调用当前渠道，产生
          {upscaleTarget.items.length > 1
            ? ` ${upscaleTarget.items.length} 次真实用量。`
            : '一次真实用量。'}
        </p>
        <p className={styles.hint} data-ecommerce-upscale-count>
          本次处理 {upscaleTarget.items.length} 张
        </p>
        <div className={styles.upscaleSection}>
          <span className={styles.upscaleLabel}>方案</span>
          <div className={styles.editPresets} aria-label="AI 超清方案">
            {availableUpscaleOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={
                  option.id === upscaleProfile
                    ? `${styles.editPreset} ${styles.editPresetOn}`
                    : styles.editPreset
                }
                data-ecommerce-upscale-profile={option.id}
                title={option.hint}
                onClick={() => onProfileChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.upscaleSection}>
          <span className={styles.upscaleLabel}>放大倍数</span>
          <div className={styles.editPresets} aria-label="AI 超清倍数">
            {ECOMMERCE_UPSCALE_SCALES.map((scale) => (
              <button
                key={scale}
                type="button"
                className={
                  scale === upscaleScale
                    ? `${styles.editPreset} ${styles.editPresetOn}`
                    : styles.editPreset
                }
                data-ecommerce-upscale-scale={scale}
                onClick={() => onScaleChange(scale)}
              >
                {scale}
              </button>
            ))}
          </div>
        </div>
        <p className={styles.hint} data-ecommerce-upscale-model>
          {
            availableUpscaleOptions.find((option) => option.id === upscaleProfile)?.model
          }
        </p>
        {upscaleError ? (
          <p className={styles.editError} data-ecommerce-upscale-error>
            {upscaleError}
          </p>
        ) : null}
        <div className={styles.confirmActions}>
          <button
            type="button"
            className={styles.cancel}
            data-ecommerce-upscale-cancel
            disabled={upscaleSubmitting}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className={styles.generate}
            data-ecommerce-upscale-submit
            disabled={upscaleSubmitting || running}
            onClick={() => void onSubmit()}
          >
            {upscaleSubmitting
              ? `提交中…（${upscaleTarget.items.length} 张）`
              : `AI 超清 ${upscaleScale}${upscaleTarget.items.length > 1 ? `（${upscaleTarget.items.length}）` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

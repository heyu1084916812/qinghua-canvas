import {
  ecommerceRatioLabel,
  usageLabel,
} from '../../../domain/ecommerce/types'
import type { EcommerceUsage } from '../../../domain/ecommerce/types'
import type { EcommercePlatform } from '../../../domain/ecommerce/platforms'
import { styles } from './studioStyles'
import type { StudioMode } from './studioContracts'

export function EcommerceStudioGenerateConfirmDialog({
  confirming,
  mode,
  batchOutputCount,
  usage,
  ratio,
  platform,
  confirmUsesAiPlan,
  onCancel,
  onConfirm,
}: {
  confirming: boolean
  mode: StudioMode
  batchOutputCount: number
  usage: EcommerceUsage
  ratio: string
  platform: EcommercePlatform | null
  confirmUsesAiPlan: boolean
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  if (!confirming) return null
  return (
    <div className={styles.confirm} role="dialog" aria-modal="true" data-ecommerce-confirm>
      <div className={styles.confirmCard}>
        <h2 className={styles.confirmTitle}>确认生成</h2>
        <p className={styles.confirmText}>
          将生成 <b>{mode.mediaKind === 'video' ? 1 : batchOutputCount}</b>{' '}
          {mode.mediaKind === 'video' ? '条' : '张'}
          {mode.mediaKind === 'video' ? mode.label : usageLabel(usage)}，比例{' '}
          {ecommerceRatioLabel(ratio)}
          {platform ? `，面向 ${platform.name}` : ''}。会调用你的渠道，产生真实用量。
        </p>
        {confirmUsesAiPlan ? (
          <p className={styles.confirmFlow} data-ecommerce-confirm-ai-flow>
            确认后会先生成整批方案，再由 AI 自审并修正逐张提示词，然后交给生图模型。
            本次会多花一次对话额度。
          </p>
        ) : null}
        <div className={styles.confirmActions}>
          <button
            type="button"
            className={styles.cancel}
            data-ecommerce-confirm-cancel
            onClick={onCancel}
          >
            再改改
          </button>
          <button
            type="button"
            className={styles.generate}
            data-ecommerce-confirm-ok
            onClick={() => void onConfirm()}
          >
            确认生成 {mode.mediaKind === 'video' ? 1 : batchOutputCount}{' '}
            {mode.mediaKind === 'video' ? '条视频' : '张'}
          </button>
        </div>
      </div>
    </div>
  )
}

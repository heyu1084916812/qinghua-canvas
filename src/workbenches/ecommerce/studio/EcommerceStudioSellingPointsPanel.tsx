import { ECOMMERCE_NOTE_MAX } from '../../../domain/ecommerce/prompt'
import { styles } from './studioStyles'

export function EcommerceStudioSellingPointsPanel({
  visible,
  note,
  writingSellingPoints,
  chatTargetLabel,
  sellingPointsError,
  onWriteSellingPoints,
  onNoteChange,
}: {
  visible: boolean
  note: string
  writingSellingPoints: boolean
  chatTargetLabel: string
  sellingPointsError: string
  onWriteSellingPoints: () => Promise<void>
  onNoteChange: (value: string) => void
}) {
  if (!visible) return null
  return (
    <section className={styles.block} data-param-section="selling">
      <div className={styles.blockHead}>
        <label className={styles.blockTitle} htmlFor="ecommerce-note">
          商品卖点 &amp; 要求
        </label>
        <button
          type="button"
          className={styles.aiWrite}
          data-ecommerce-ai-write
          disabled={writingSellingPoints || !chatTargetLabel}
          onClick={() => void onWriteSellingPoints()}
        >
          {writingSellingPoints ? '生成中…' : 'AI 帮写'}
        </button>
      </div>
      <textarea
        id="ecommerce-note"
        className={styles.textarea}
        value={note}
        maxLength={ECOMMERCE_NOTE_MAX}
        placeholder="例：突出防水材质；模特手持场景；不要出现文字"
        data-ecommerce-note
        onChange={(event) => onNoteChange(event.target.value)}
      />
      {sellingPointsError ? (
        <p className={styles.error} role="alert" data-ecommerce-ai-write-error>
          {sellingPointsError}
        </p>
      ) : null}
    </section>
  )
}

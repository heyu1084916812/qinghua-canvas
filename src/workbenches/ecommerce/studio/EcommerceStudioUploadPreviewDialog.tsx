import { styles } from './studioStyles'
import type { EcommerceUpload } from './studioContracts'

export function EcommerceStudioUploadPreviewDialog({
  uploadPreviewItem,
  uploadPreviewIndex,
  uploadPreviewCount,
  onClose,
  onPrevious,
  onNext,
}: {
  uploadPreviewItem: EcommerceUpload | null
  uploadPreviewIndex: number
  uploadPreviewCount: number
  onClose: () => void
  onPrevious: () => void
  onNext: () => void
}) {
  if (!uploadPreviewItem) return null
  return (
    <div
      className={styles.uploadLightbox}
      role="dialog"
      aria-modal="true"
      data-ecommerce-upload-lightbox
      onClick={onClose}
    >
      <div className={styles.uploadLightboxBody} onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className={styles.uploadLightboxClose}
          aria-label="关闭预览"
          onClick={onClose}
        >
          ×
        </button>
        <button
          type="button"
          className={`${styles.uploadLightboxArrow} ${styles.uploadLightboxPrev}`}
          aria-label="上一张"
          disabled={uploadPreviewIndex <= 0}
          onClick={onPrevious}
        >
          ‹
        </button>
        <div className={styles.uploadLightboxStage}>{uploadPreviewItem.preview}</div>
        <button
          type="button"
          className={`${styles.uploadLightboxArrow} ${styles.uploadLightboxNext}`}
          aria-label="下一张"
          disabled={uploadPreviewIndex >= uploadPreviewCount - 1}
          onClick={onNext}
        >
          ›
        </button>
        <span className={styles.uploadLightboxCount} data-ecommerce-upload-position>
          {uploadPreviewIndex + 1} / {uploadPreviewCount}
        </span>
      </div>
    </div>
  )
}

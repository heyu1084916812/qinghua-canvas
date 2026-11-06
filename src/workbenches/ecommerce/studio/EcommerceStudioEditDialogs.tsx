import { ECOMMERCE_NOTE_MAX } from '../../../domain/ecommerce/prompt'
import { EcommerceSelect } from '../EcommerceSelect'
import { styles } from './studioStyles'
import { modelIconFor } from './studioSharedViews'
import type { EcommerceUpload } from './studioContracts'
import type { StudioActionResultTarget } from './controller/studioActionCoordinator'

interface EditPreset {
  key: string
  label: string
  instruction: string
}

export function EcommerceStudioEditDialogs({
  batchEditOpen,
  selectedImageEditCount,
  editPresets,
  batchInstruction,
  batchEditError,
  batchReference,
  batchReferenceBusy,
  editModels,
  batchEditModel,
  batchEditSubmitting,
  running,
  editTarget,
  editInstruction,
  editError,
  editReference,
  editReferenceBusy,
  editModel,
  editSubmitting,
  onBatchInstructionChange,
  onBatchPreset,
  onPickBatchReference,
  onRemoveBatchReference,
  onBatchModelChange,
  onBatchCancel,
  onBatchSubmit,
  onEditInstructionChange,
  onEditPreset,
  onPickEditReference,
  onRemoveEditReference,
  onEditModelChange,
  onEditCancel,
  onEditSubmit,
}: {
  batchEditOpen: boolean
  selectedImageEditCount: number
  editPresets: readonly EditPreset[]
  batchInstruction: string
  batchEditError: string
  batchReference: EcommerceUpload | null
  batchReferenceBusy: boolean
  editModels: readonly string[]
  batchEditModel: string
  batchEditSubmitting: boolean
  running: boolean
  editTarget: StudioActionResultTarget | null
  editInstruction: string
  editError: string
  editReference: EcommerceUpload | null
  editReferenceBusy: boolean
  editModel: string
  editSubmitting: boolean
  onBatchInstructionChange: (value: string) => void
  onBatchPreset: (instruction: string) => void
  onPickBatchReference: (file: File | undefined) => Promise<void>
  onRemoveBatchReference: () => void
  onBatchModelChange: (value: string) => void
  onBatchCancel: () => void
  onBatchSubmit: () => Promise<void>
  onEditInstructionChange: (value: string) => void
  onEditPreset: (instruction: string) => void
  onPickEditReference: (file: File | undefined) => Promise<void>
  onRemoveEditReference: () => void
  onEditModelChange: (value: string) => void
  onEditCancel: () => void
  onEditSubmit: () => Promise<void>
}) {
  return (
    <>
      {batchEditOpen ? (
        <div
          className={styles.confirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ecommerce-batch-edit-title"
          data-ecommerce-batch-edit-dialog
        >
          <div className={styles.confirmCard}>
            <h2 className={styles.confirmTitle} id="ecommerce-batch-edit-title">
              批量 AI 编辑
            </h2>
            <p className={styles.confirmText}>
              将对选中的 {selectedImageEditCount} 张图逐张执行同一套修改要求。每张都会生成独立新批次，
              原结果全部保留；会调用你的渠道，产生 {selectedImageEditCount} 次真实用量。
            </p>
            <div className={styles.editPresets} aria-label="常用批量编辑要求">
              {editPresets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={styles.editPreset}
                  data-ecommerce-batch-edit-preset={preset.key}
                  onClick={() => onBatchPreset(preset.instruction)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className={styles.editReferenceRow}>
              <input
                id="ecommerce-batch-edit-reference"
                type="file"
                accept="image/*"
                hidden
                data-ecommerce-batch-edit-reference-input
                disabled={batchReferenceBusy}
                onChange={(event) => {
                  void onPickBatchReference(event.target.files?.[0])
                  event.currentTarget.value = ''
                }}
              />
              <label className={styles.editPreset} htmlFor="ecommerce-batch-edit-reference">
                {batchReferenceBusy
                  ? '正在读取参考图…'
                  : batchReference
                    ? '更换参考图'
                    : '上传参考图（可选）'}
              </label>
              {batchReference ? (
                <span className={styles.editReferencePreview} data-ecommerce-batch-edit-reference-preview>
                  {batchReference.preview}
                  <button
                    type="button"
                    className={styles.linkBtn}
                    data-ecommerce-batch-edit-reference-remove
                    onClick={onRemoveBatchReference}
                  >
                    移除
                  </button>
                </span>
              ) : null}
            </div>
            {editModels.length > 0 ? (
              <div className={styles.editModel}>
                <span>编辑模型</span>
                <EcommerceSelect
                  ariaLabel="批量编辑模型"
                  name="batch-edit-model"
                  value={batchEditModel}
                  onChange={onBatchModelChange}
                  menuMinWidth={250}
                  options={[
                    { value: '', label: '跟随原任务模型' },
                    ...editModels.map((item) => ({
                      value: item,
                      label: item,
                      icon: modelIconFor(item),
                    })),
                  ]}
                  dataAttributes={{ 'data-ecommerce-batch-edit-model': true }}
                />
              </div>
            ) : null}
            <textarea
              className={styles.editInput}
              data-ecommerce-batch-edit-instruction
              value={batchInstruction}
              maxLength={ECOMMERCE_NOTE_MAX}
              onChange={(event) => onBatchInstructionChange(event.target.value)}
              placeholder="例如：只把每一张的背景都换成浅灰摄影棚背景，产品和文字保持不变"
              aria-label="这批图统一要改什么"
            />
            {batchEditError ? (
              <p className={styles.editError} data-ecommerce-batch-edit-error>
                {batchEditError}
              </p>
            ) : null}
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.cancel}
                data-ecommerce-batch-edit-cancel
                disabled={batchEditSubmitting}
                onClick={onBatchCancel}
              >
                取消
              </button>
              <button
                type="button"
                className={`${styles.generate} ${styles.editSubmit}`}
                data-ecommerce-batch-edit-submit
                disabled={
                  batchEditSubmitting ||
                  running ||
                  selectedImageEditCount === 0 ||
                  !batchInstruction.trim()
                }
                onClick={() => void onBatchSubmit()}
              >
                {batchEditSubmitting ? '正在逐张执行…' : `生成 ${selectedImageEditCount} 张编辑结果`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editTarget ? (
        <div
          className={styles.confirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ecommerce-edit-title"
          data-ecommerce-edit-dialog
        >
          <div className={styles.confirmCard}>
            <h2 className={styles.confirmTitle} id="ecommerce-edit-title">
              AI 编辑这一张
            </h2>
            <p className={styles.confirmText}>
              {editTarget.label}。只改你写明的内容，未点名的产品、人物、构图、光影和文字保持不变；
              原图与历史都不会被覆盖。
            </p>
            <div className={styles.editPresets} aria-label="常用编辑要求">
              {editPresets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={styles.editPreset}
                  data-ecommerce-edit-preset={preset.key}
                  onClick={() => onEditPreset(preset.instruction)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className={styles.editReferenceRow}>
              <input
                id="ecommerce-edit-reference"
                type="file"
                accept="image/*"
                hidden
                data-ecommerce-edit-reference-input
                disabled={editReferenceBusy}
                onChange={(event) => {
                  void onPickEditReference(event.target.files?.[0])
                  event.currentTarget.value = ''
                }}
              />
              <label className={styles.editPreset} htmlFor="ecommerce-edit-reference">
                {editReferenceBusy ? '正在读取参考图…' : editReference ? '更换参考图' : '上传参考图（可选）'}
              </label>
              {editReference ? (
                <span className={styles.editReferencePreview} data-ecommerce-edit-reference-preview>
                  {editReference.preview}
                  <button
                    type="button"
                    className={styles.linkBtn}
                    data-ecommerce-edit-reference-remove
                    onClick={onRemoveEditReference}
                  >
                    移除
                  </button>
                </span>
              ) : null}
            </div>
            {editModels.length > 0 ? (
              <div className={styles.editModel}>
                <span>编辑模型</span>
                <EcommerceSelect
                  ariaLabel="单张编辑模型"
                  name="edit-model"
                  value={editModel}
                  onChange={onEditModelChange}
                  menuMinWidth={250}
                  options={[
                    { value: '', label: '跟随原任务模型' },
                    ...editModels.map((item) => ({
                      value: item,
                      label: item,
                      icon: modelIconFor(item),
                    })),
                  ]}
                  dataAttributes={{ 'data-ecommerce-edit-model': true }}
                />
              </div>
            ) : null}
            <textarea
              className={styles.editInput}
              data-ecommerce-edit-instruction
              value={editInstruction}
              maxLength={ECOMMERCE_NOTE_MAX}
              onChange={(event) => onEditInstructionChange(event.target.value)}
              placeholder="例如：只把背景换成海边日落，产品和画面文字保持不变"
              aria-label="这一张要改什么"
            />
            {editError ? (
              <p className={styles.editError} data-ecommerce-edit-error>
                {editError}
              </p>
            ) : null}
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.cancel}
                data-ecommerce-edit-cancel
                disabled={editSubmitting}
                onClick={onEditCancel}
              >
                取消
              </button>
              <button
                type="button"
                className={`${styles.generate} ${styles.editSubmit}`}
                data-ecommerce-edit-submit
                disabled={editSubmitting || running || !editInstruction.trim()}
                onClick={() => void onEditSubmit()}
              >
                {editSubmitting ? '提交中…' : '生成编辑结果'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

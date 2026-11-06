import type {
  Dispatch,
  DragEvent as ReactDragEvent,
  SetStateAction,
} from 'react'
import { styles } from './studioStyles'
import type { StudioMode, EcommerceUpload } from './studioContracts'
import type { StudioUploadKind } from './controller/studioActionCoordinator'

interface UploadDropProps {
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void
  onDragLeave: (event: ReactDragEvent<HTMLElement>) => void
  onDrop: (event: ReactDragEvent<HTMLElement>) => void
}

export function EcommerceStudioUploadPanels({
  mode,
  products,
  references,
  productLimit,
  batchWhite,
  dragOver,
  referenceRequired,
  showReferenceBlock,
  referenceLabel,
  dropProps,
  onPick,
  setProducts,
  setReferences,
  setUploadPreview,
}: {
  mode: StudioMode
  products: readonly EcommerceUpload[]
  references: readonly EcommerceUpload[]
  productLimit: number
  batchWhite: boolean
  dragOver: StudioUploadKind | null
  referenceRequired: boolean
  showReferenceBlock: boolean
  referenceLabel: string
  dropProps: (kind: StudioUploadKind) => UploadDropProps
  onPick: (file: File, kind: StudioUploadKind) => Promise<void>
  setProducts: Dispatch<SetStateAction<EcommerceUpload[]>>
  setReferences: Dispatch<SetStateAction<EcommerceUpload[]>>
  setUploadPreview: Dispatch<SetStateAction<{
    kind: 'product' | 'reference'
    index: number
  } | null>>
}) {
  return (
    <>
      <section
        className={dragOver === 'product' ? `${styles.block} ${styles.blockDrop}` : styles.block}
        data-ecommerce-product-drop={dragOver === 'product' ? 'true' : 'false'}
        data-param-section="product"
        {...dropProps('product')}
      >
        <div className={styles.blockHead}>
          <label className={styles.blockTitle} htmlFor="ecommerce-product">
            商品原图
          </label>
          <span className={styles.hint} data-ecommerce-product-hint>
            {batchWhite
              ? `支持 1–12 张源图；每张按上方角度独立生成，最多 36 张输出`
              : '支持 1–3 张图片，多角度效果更佳'}
          </span>
        </div>
        <input
          id="ecommerce-product"
          className={styles.file}
          type="file"
          accept="image/*"
          multiple
          data-ecommerce-product-input
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            void (async () => {
              for (const file of files) await onPick(file, 'product')
            })()
            event.currentTarget.value = ''
          }}
        />
        <div className={styles.slotRow}>
          {products.map((item, index) => (
            <div key={item.nodeId} className={styles.slot} data-ecommerce-product-preview>
              <button
                type="button"
                className={styles.slotPreview}
                data-ecommerce-product-open={index}
                aria-label={`放大预览第 ${index + 1} 张商品图`}
                onClick={() => setUploadPreview({ kind: 'product', index })}
              >
                {item.preview}
              </button>
              <button
                type="button"
                className={styles.slotRemove}
                aria-label={`移除第 ${index + 1} 张产品图`}
                onClick={() => setProducts((current) =>
                  current.filter((row) => row.nodeId !== item.nodeId),
                )}
              >
                ×
              </button>
            </div>
          ))}
          {products.length === 0 ? (
            <label className={styles.emptySlot} htmlFor="ecommerce-product">
              <span className={styles.uploadPlus}>+</span>
              <span>上传图片</span>
            </label>
          ) : products.length < productLimit &&
            (batchWhite || products.length + references.length < 4) ? (
            <label className={styles.addSlot} htmlFor="ecommerce-product" data-ecommerce-product-add>
              +
            </label>
          ) : null}
        </div>
      </section>

      {showReferenceBlock ? (
        <section
          className={
            dragOver === 'reference' ? `${styles.block} ${styles.blockDrop}` : styles.block
          }
          data-ecommerce-reference-drop={dragOver === 'reference' ? 'true' : 'false'}
          {...dropProps('reference')}
        >
          <div className={styles.blockHead}>
            <label className={styles.blockTitle} htmlFor="ecommerce-reference">
              {referenceLabel}
            </label>
            <span className={styles.hint}>{referenceRequired ? '必填' : '选填'}</span>
          </div>
          <input
            id="ecommerce-reference"
            className={styles.file}
            type="file"
            accept={mode.id === 'video-recreate' ? 'video/*,image/*' : 'image/*'}
            multiple={mode.id !== 'video-recreate'}
            data-ecommerce-reference-input
            onChange={(event) => {
              const files = [...(event.target.files ?? [])]
              void (async () => {
                for (const file of files) await onPick(file, 'reference')
              })()
            }}
          />
          <div className={styles.slotRow}>
            {references.map((item) => (
              <div key={item.nodeId} className={styles.slot} data-ecommerce-reference-preview>
                <button
                  type="button"
                  className={styles.slotPreview}
                  data-ecommerce-reference-open={references.indexOf(item)}
                  aria-label="放大预览参考图"
                  onClick={() =>
                    setUploadPreview({ kind: 'reference', index: references.indexOf(item) })
                  }
                >
                  {item.preview}
                </button>
                <button
                  type="button"
                  className={styles.slotRemove}
                  aria-label="移除参考图"
                  onClick={() =>
                    setReferences((current) =>
                      current.filter((row) => row.nodeId !== item.nodeId),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
            {references.length + products.length < 4 ? (
              <label
                className={styles.addSlot}
                htmlFor="ecommerce-reference"
                data-ecommerce-reference-add
              >
                +
              </label>
            ) : null}
          </div>
          {referenceRequired && references.length === 0 ? (
            <p className={styles.hint} data-ecommerce-recreate-hint>
              {mode.id === 'video-recreate'
                ? '先上传参考视频，再生成同款视频。'
                : mode.id === 'wear-tryon'
                  ? '先上传人物参考图，服装和人物都会以素材为准。'
                  : '先上传爆款参考图，产品主体仍以商品原图为准。'}
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  )
}

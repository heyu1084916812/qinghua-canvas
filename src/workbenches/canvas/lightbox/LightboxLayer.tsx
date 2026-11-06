import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react'
import { useCanvasStore } from '../storeContext'
import { useAssetMeta } from '../../../features/shared/assets/index'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import type { Viewport } from '../../../domain/canvas/geometry/coords'
import type { FusionRect } from '../../../domain/canvas/model/node'
import {
  CROP_HANDLES,
  FUSION_MIN_EDGE,
  fitRectToRatio,
  ratioValueOf,
} from '../../../domain/canvas/fusion/fusionPlan'
import { RATIO_CHOICES } from '../../../domain/canvas/layout/ratioChoices'
import { cropAsset, extractSelection } from '../../../features/canvas/extractSelection'
import { downloadAsset } from '../../../features/shared/assets/downloadAsset'
import { createId } from '../../../shared/id'
import {
  ANNOTATE_COLORS,
  clampAnnotateTextSize,
  drawAnnotateOp,
  type AnnotateOp,
  type AnnotateTextItem,
  type AnnotateTool,
} from '../annotate/annotateOps'
import { saveAnnotatedAsset } from '../annotate/bakeAnnotate'
import { saveRotatedAsset } from '../rotate/bakeRotate'
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconDelete,
  IconMirrorH,
  IconMirrorV,
  IconRedo,
  IconUndo,
} from '../toolbar/icons'
import styles from './LightboxLayer.module.css'
import {
  isTextEditingTarget,
  shouldCloseOnStageClick,
  type CompareView,
  type LightboxEditorMode,
} from './lightboxKeyboard'
import {
  galleryViewOf,
} from './lightboxGallery'
import { ANNOTATE_TOOLS, HANDLE_POS } from './lightboxCatalog'
import { GalleryThumb } from './LightboxGalleryThumb'
import {
  createLightboxAnnotationActions,
  type LightboxAnnotationCanvas,
  type LightboxAnnotationState,
  type LightboxPointerDragHandlers,
} from './lightboxAnnotationCoordinator'
import {
  createLightboxCropActions,
  type LightboxCropState,
} from './lightboxCropActionCoordinator'
import { createLightboxViewportGestureCoordinator } from './lightboxViewportGestureCoordinator'
import {
  createLightboxCommandLifecycle,
  type LightboxCommandKeyEvent,
} from './lightboxCommandLifecycle'
import { lightboxEditorProjectionOf } from './lightboxEditorProjection'
import {
  lightboxCompareAvailableOf,
  lightboxCompareSourceOf,
  lightboxMediaProjectionOf,
} from './lightboxMediaProjection'

function annotationCanvasBox(canvas: HTMLCanvasElement): LightboxAnnotationCanvas {
  const { left, top, width, height } = canvas.getBoundingClientRect()
  return { left, top, width, height, pixelWidth: canvas.width, pixelHeight: canvas.height }
}

function subscribeWindowPointerDrag(handlers: LightboxPointerDragHandlers): () => void {
  const controller = new AbortController()
  const move = (event: PointerEvent) => handlers.onMove({ clientX: event.clientX, clientY: event.clientY })
  window.addEventListener('pointermove', move, { signal: controller.signal })
  window.addEventListener('pointerup', handlers.onUp, { signal: controller.signal })
  return () => controller.abort()
}

function subscribeLightboxCommandKeydown(
  listener: (event: LightboxCommandKeyEvent) => void,
): () => void {
  const onKey = (event: KeyboardEvent) => listener({
    key: event.key,
    editingText: isTextEditingTarget(
      event.target instanceof HTMLElement
        ? { tagName: event.target.tagName, isContentEditable: event.target.isContentEditable }
        : null,
    ),
    preventDefault: () => event.preventDefault(),
  })
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}

/** 素材灯箱（§6.17）：宿主保留 React state/refs、DOM 与 JSX，生命周期交给命令 / 手势协调器。 */
export function LightboxLayer() {
  const store = useCanvasStore()
  const platform = usePlatform()
  const lightbox = useSyncExternalStore(store.subscribe, store.getLightbox, store.getLightbox)
  const assetHash = lightbox?.assetHash
  const { gallery, galleryIndex, galleryItem, hasGalleryNavigation } = galleryViewOf(lightbox)
  const { url, mime } = useAssetMeta(assetHash)
  const isVideo = (mime ?? '').startsWith('video/')
  const stageRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const movedRef = useRef(false)
  const [stage, setStage] = useState<Rect | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [vp, setVp] = useState<Viewport | null>(null)
  const [mode, setMode] = useState<LightboxEditorMode>('view')
  const previousAssetHashRef = useRef<string | undefined>(undefined)
  const preserveViewportAfterMediaLoadRef = useRef(false)

  const [cropRect, setCropRect] = useState<FusionRect | null>(null)
  const [cropRatio, setCropRatio] = useState('')
  const [busy, setBusy] = useState(false)
  const ratioValue = ratioValueOf(cropRatio)
  const [compareView, setCompareView] = useState<CompareView>('first')
  const [splitRatio, setSplitRatio] = useState(0.5)
  const [angle, setAngle] = useState(0)
  const [rotateStep, setRotateStep] = useState(90)
  const [mirrorH, setMirrorH] = useState(false)
  const [mirrorV, setMirrorV] = useState(false)
  const [rotating2, setRotating2] = useState(false)
  const nodes = store.getSnapshot().nodes
  const compareSource = lightboxCompareSourceOf({ nodes, assetHash, compareWith: lightbox?.compareWith, compareKind: lightbox?.compareKind })
  const compareAsset = useAssetMeta(compareSource.compareHash ?? undefined)
  const { compareHash, compareKind } = compareSource
  const compareUrl = compareAsset.url
  const compareIsVideo = (compareAsset.mime ?? '').startsWith('video/')
  const compareAvailable = lightboxCompareAvailableOf({ compareHash: compareSource.compareHash, compareUrl: compareAsset.url, isVideo, compareIsVideo })
  const editorProjection = lightboxEditorProjectionOf({ nodes, assetHash, isVideo, mode, lightbox, compareAvailable })
  const mediaProjection = lightboxMediaProjectionOf({
    assetHash, url, isVideo, compareHash: compareSource.compareHash, compareUrl: compareAsset.url,
    compareIsVideo, compareKind: compareSource.compareKind, compareView, splitRatio, mode,
    rotating: editorProjection.rotating, cropping: editorProjection.cropping,
    angle, mirrorH, mirrorV, cropRect, natural, viewport: vp,
  })
  const {
    cropFor, faceFor, cropPlainRequested: cropPlain, ownerNode, ownerNodeId, rotateNodeId,
    annotateNodeId, cropping, plainCrop, rotating, annotating, availableModes,
  } = editorProjection
  const { view, splitActive, showSecondOnly, compareViews, compareLeftHash, compareRightHash,
    primaryUrl, primaryIsVideo, compareClipPath, box, normalizedAngle, mediaStyle, cropBox, canConfirm,
  } = mediaProjection
  /** 标注画布覆盖在媒体矩形上，累积原图像素动作；左键绘制，其余指针手势留给舞台。 */
  const [annTool, setAnnTool] = useState<AnnotateTool>('brush')
  const [annColor, setAnnColor] = useState<string>(ANNOTATE_COLORS[0])
  const [annSize, setAnnSize] = useState(6)
  const [annOps, setAnnOps] = useState<AnnotateOp[]>([])
  const [annTextItems, setAnnTextItems] = useState<AnnotateTextItem[]>([])
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [annUndone, setAnnUndone] = useState<AnnotateOp[]>([])
  const [annSaving, setAnnSaving] = useState(false)
  const annCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const annDrawingRef = useRef<AnnotateOp | null>(null)
  const annStateRef = useRef<LightboxAnnotationState | null>(null)
  annStateRef.current = {
    tool: annTool, color: annColor, size: annSize, ops: annOps, textItems: annTextItems,
    selectedTextId, editingTextId, undone: annUndone,
    viewport: vp, natural, annotating, saving: annSaving,
  }
  const [annActions] = useState(() =>
    createLightboxAnnotationActions({
      state: () => annStateRef.current!,
      getDrawing: () => annDrawingRef.current,
      setDrawing: (drawing) => { annDrawingRef.current = drawing },
      setTextItems: setAnnTextItems, setSelectedTextId, setEditingTextId,
      setOps: setAnnOps, setUndone: setAnnUndone, setTool: setAnnTool, setSaving: setAnnSaving,
      capturePointer: (pointerId) => annCanvasRef.current?.setPointerCapture(pointerId),
      scheduleTextEditing: (id) => window.setTimeout(() => setEditingTextId(id), 0),
      createTextId: () => createId('text'), subscribePointerDrag: subscribeWindowPointerDrag,
      hasNode: (nodeId) => store.getSnapshot().nodes.some((node) => node.id === nodeId), selectNode: (id) => store.setSelection([id]),
      saveAnnotation: async ({ nodeId, url, ops, textItems }) => {
        const graph = store.getSnapshot()
        const node = graph.nodes.find((candidate) => candidate.id === nodeId)
        return node ? saveAnnotatedAsset({ store, graph, node, url, ops: [...ops], textItems: [...textItems] }) : null
      },
      close: () => store.closeLightbox(),
    }),
  )
  useEffect(() => () => annActions.dispose(), [annActions])

  /** 只重画标注操作；底图由灯箱 `<img>` 承担，正在画的一笔也参与回放。 */
  const redrawAnn = useCallback(() => {
    const canvas = annCanvasRef.current
    if (!canvas || !canvas.width) return
    const g2 = canvas.getContext('2d')
    if (!g2) return
    g2.clearRect(0, 0, canvas.width, canvas.height)
    const all = annDrawingRef.current ? [...annOps, annDrawingRef.current] : annOps
    for (const op of all) drawAnnotateOp(g2, op)
  }, [annOps])

  useEffect(() => {
    void redrawAnn()
  }, [redrawAnn, natural, annotating])

  /** 下载反馈、键盘导航和旋转 / 标注保存由命令生命周期编排。 */
  const [downloaded, setDownloaded] = useState(false)
  const [commands] = useState(() => createLightboxCommandLifecycle({
    close: () => store.closeLightbox(),
    navigateGallery: (delta) => store.navigateLightbox(delta),
    download: (hash, title) => downloadAsset({ assets: platform.assets, files: platform.files }, hash, title),
    setDownloaded,
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancelSchedule: (handle) => window.clearTimeout(handle),
    focusClose: () => closeRef.current?.focus(),
    subscribeKeydown: subscribeLightboxCommandKeydown,
    nodeHasComparePair: (hash) => store.getSnapshot().nodes.some((candidate) => {
      const data = candidate.data as { assetHash?: unknown; compareWith?: unknown }; return data.assetHash === hash && typeof data.compareWith === 'string'
    }),
    setMode, setAngle, setMirrorH, setMirrorV, resetAnnotation: annActions.resetAnnotation, setCropRect, setCropRatio,
    prepareRotation: (nodeId) => {
      const graph = store.getSnapshot(), node = graph.nodes.find((candidate) => candidate.id === nodeId)
      return node ? (input) => saveRotatedAsset({ store, graph, node, ...input }) : null
    },
    setRotationBusy: setRotating2,
    saveAnnotation: (nodeId, url) => annActions.saveAnnotation(nodeId, url),
    deleteSelectedTextForKey: (key) => annActions.deleteSelectedTextForKey(key),
  }))
  const { close, navigateGallery } = commands
  useEffect(() => commands.initializeMode({ assetHash, faceFor, cropFor, cropPlain, rotateFor: lightbox?.rotateFor, annotateFor: lightbox?.annotateFor, compareWith: lightbox?.compareWith }), [assetHash, commands, cropFor, cropPlain, faceFor, lightbox?.annotateFor, lightbox?.compareWith, lightbox?.rotateFor])
  useEffect(() => commands.resetRotationEditor(lightbox?.rotateFor), [commands, lightbox?.rotateFor])
  useEffect(() => commands.resetAnnotation(assetHash), [assetHash, commands, lightbox?.annotateFor])
  useEffect(() => commands.watchKeyboard({ assetHash, mode, hasGalleryNavigation }), [assetHash, commands, hasGalleryNavigation, mode])
  useEffect(() => commands.resetCropSelection(), [assetHash, commands, cropFor, faceFor])
  useEffect(() => () => commands.dispose(), [commands])
  /** 事件时刻的舞台矩形：不读 state，避免缩放 / 平移后拿到过期值 */
  const rectNow = (): Rect | null => {
    const r = stageRef.current?.getBoundingClientRect()
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
  }

  const cropStateRef = useRef<LightboxCropState | null>(null)
  cropStateRef.current = {
    cropRect, cropRatio, ratioValue, natural, viewport: vp, faceFor, cropFor, ownerNodeId, plainCrop,
  }
  const [cropActions] = useState(() =>
    createLightboxCropActions({
      state: () => cropStateRef.current!,
      stageRect: rectNow,
      setCropRect,
      setMoved: (value) => { movedRef.current = value },
      setBusy,
      notify: (message, tone) => store.notify(message, tone),
      updateFaceBox: (nodeId, box) => { store.dispatch({ kind: 'node.updateData', id: nodeId, patch: { faceBox: box } }) },
      crop: (input) => cropAsset({ platform, store }, input),
      extract: (input) => extractSelection({ platform, store }, input),
      close,
      subscribePointerDrag: subscribeWindowPointerDrag,
    }),
  )
  useEffect(() => () => cropActions.dispose(), [cropActions])
  const { lockCrop, startMove, startCrop, startResize, confirmCrop } = cropActions

  const [viewportGestures] = useState(() =>
    createLightboxViewportGestureCoordinator({
      stageRect: rectNow, setStage, setNatural, setViewport: setVp, setCompareView, setSplitRatio,
      setMoved: (value) => { movedRef.current = value },
      previousAssetHash: () => previousAssetHashRef.current,
      setPreviousAssetHash: (value) => { previousAssetHashRef.current = value },
      setPreserveViewportAfterMediaLoad: (value) => { preserveViewportAfterMediaLoadRef.current = value },
      preserveViewportAfterMediaLoad: () => preserveViewportAfterMediaLoadRef.current,
      clearPreserveViewportAfterMediaLoad: () => { preserveViewportAfterMediaLoadRef.current = false },
      startCrop, subscribeResize: (listener) => { window.addEventListener('resize', listener); return () => window.removeEventListener('resize', listener) },
      subscribePointerDrag: subscribeWindowPointerDrag,
    }),
  )
  useEffect(() => viewportGestures.prepareAssetSwitch(assetHash, hasGalleryNavigation), [assetHash, hasGalleryNavigation, viewportGestures])
  useEffect(() => viewportGestures.resetCompareView(!!lightbox?.compareWith), [assetHash, lightbox?.compareWith, compareKind, viewportGestures])
  useEffect(() => viewportGestures.watchStage(assetHash), [assetHash, viewportGestures])
  useEffect(() => viewportGestures.fitInitialViewport(natural, stage, vp), [natural, stage, vp, viewportGestures])
  useEffect(() => () => viewportGestures.dispose(), [viewportGestures])

  const onAnnDown = (e: ReactPointerEvent<HTMLCanvasElement>) => annActions.pointerDown(e, annotationCanvasBox(e.currentTarget), redrawAnn)
  const onAnnMove = (e: ReactPointerEvent<HTMLCanvasElement>) => annActions.pointerMove(e, annotationCanvasBox(e.currentTarget), redrawAnn)
  const onAnnUp = () => annActions.pointerUp(redrawAnn)

  const { patchTextItem, deleteTextItem, selectTextItem, startTextMove, startTextResize, undoAnn, redoAnn } = annActions
  useEffect(() => commands.watchAnnotationDelete({ annotating, selectedTextId, editingTextId }), [annotating, commands, editingTextId, selectedTextId])

  const onWheel = (e: ReactWheelEvent) => viewportGestures.wheel(e, vp)
  const onPointerDown = (e: ReactPointerEvent) => viewportGestures.pointerDown(e, { viewport: vp, cropping })

  if (!lightbox) return null

  const placed = natural !== null && vp !== null
  const settleNaturalSize = (w: number, h: number) => viewportGestures.settleMediaSize(w, h, vp)

  const saveRotation = () => commands.saveRotation({ nodeId: rotateNodeId, url: primaryUrl ?? undefined, busy: rotating2, angle, mirrorH, mirrorV })
  const saveAnnotation = () => commands.saveAnnotation(annotateNodeId, url ?? undefined)
  const download = () => commands.download(assetHash, ownerNode?.title)

  const startSplitDrag = (e: ReactPointerEvent) => viewportGestures.startSplitDrag(e, { mediaBox: box, splitRatio })

  const selectedTextItem = annTextItems.find((item) => item.id === selectedTextId) ?? null

  return (
    <div
      className={styles.overlay}
      data-lightbox
      // 当前展示的素材 hash：灯箱按 hash 取图，这里把它暴露出来，
      // 「灯箱显示的到底是不是这个节点的图」才可断言（否则只能比像素，纯色图比不出来）
      data-lightbox-hash={assetHash ?? ''}
      data-lightbox-gallery={hasGalleryNavigation ? 'true' : undefined}
      data-lightbox-gallery-index={hasGalleryNavigation ? galleryIndex : undefined}
      data-lightbox-gallery-title={galleryItem?.title}
      data-lightbox-mode={mode}
      // 对比原图：配对上时暴露当前档位与实际展示的 hash，供断言（§6.23）
      data-lightbox-compare={mode === 'compare' && compareAvailable ? view : undefined}
      data-lightbox-shown-hash={showSecondOnly ? (compareHash ?? '') : (assetHash ?? '')}
      data-lightbox-compare-kind={mode === 'compare' && compareAvailable ? compareKind : undefined}
      data-lightbox-compare-left-hash={
        mode === 'compare' && compareAvailable ? (compareLeftHash ?? undefined) : undefined
      }
      data-lightbox-compare-right-hash={
        mode === 'compare' && compareAvailable ? (compareRightHash ?? undefined) : undefined
      }
      role="dialog"
      aria-modal="true"
      aria-label={
        hasGalleryNavigation
          ? `素材灯箱，第 ${galleryIndex + 1} / ${gallery.length} 张${galleryItem?.title ? `：${galleryItem.title}` : ''}`
          : '素材灯箱'
      }
    >
      <div
        ref={stageRef}
        className={styles.stage}
        data-lightbox-stage
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onClick={() => {
          if (!shouldCloseOnStageClick({ cropping, mode, moved: movedRef.current })) return
          close()
        }}
      >
        {primaryUrl &&
          (primaryIsVideo ? (
            <video
              className={placed ? styles.media : styles.mediaPlain}
              data-lightbox-media
              src={primaryUrl}
              controls
              loop
              playsInline
              autoPlay
              style={mediaStyle}
              onLoadedMetadata={(e) => {
                settleNaturalSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight)
              }}
              /**
               * ⚠️ **`pointerdown` 一律放行给舞台**（用户 2026-10-16：「拖动无法进行拖动图片」）。
               *
               * 平移是舞台那一层起手的；这里原先在非框选模式下 `stopPropagation()`，
               * 于是**按在图上**（最自然的位置）拖——拖不动，只有按在图片外的留白上才行。
               * 单击关闭仍然由下面那个 `onClick` 拦住（点图不该关灯箱），两件事分开。
               */
              onClick={(e) => {
                if (!cropping) e.stopPropagation()
              }}
            />
          ) : (
            <img
              className={placed ? styles.media : styles.mediaPlain}
              data-lightbox-media
              src={primaryUrl}
              alt=""
              draggable={false}
              style={mediaStyle}
              onLoad={(e) => {
                /**
                 * 切到第二张时**不改** `natural`：box / 选区 / 分割线全部按
                 * assetHash 那张的尺寸算，两张尺寸万一不同也不会让整块视图跳一下。
                 */
                if (!showSecondOnly) {
                  settleNaturalSize(
                    e.currentTarget.naturalWidth,
                    e.currentTarget.naturalHeight,
                  )
                }
              }}
              /** 同上：`pointerdown` 让给舞台起手平移（框选模式下本来就是让的） */
              onClick={(e) => {
                if (!cropping) e.stopPropagation()
              }}
            />
          ))}
        {/*
          * 对比档按 compareKind 决定叠放方向：result = 左原图 / 右结果；
          * pair = 左 A / 右 B。两档都只改裁剪路径，不另写一套分割线。
          */}
        {placed && splitActive && compareUrl && box && (
          <>
            <img
              className={styles.media}
              data-lightbox-compare-media
              src={compareUrl}
              alt=""
              draggable={false}
              style={{ ...box, clipPath: compareClipPath }}
              /**
               * ⚠️ **这里不要拦 `pointerdown`**（用户 2026-10-16：「灯箱内的图片能进行鼠标拖动视图」）。
               *
               * 拦掉的后果是：对比模式下压在 B（右半）上拖**什么都拖不动** ——
               * 平移是靠舞台那一层的 `onPointerDown` 起手的，被这里一个 stopPropagation
               * 全挡掉。分割线自己有手柄（在更上面一层、自己带 `onPointerDown`），
               * 不需要靠拦整张图来让路。
               */
              onClick={(e) => e.stopPropagation()}
            />
            <div className={styles.compareTags} style={box} data-lightbox-compare-tags>
              <span className={styles.compareTag} data-lightbox-compare-tag="left">
                {compareKind === 'pair' ? 'A · 左' : '原图'}
              </span>
              <span className={styles.compareTag} data-lightbox-compare-tag="right">
                {compareKind === 'pair' ? 'B · 右' : '结果'}
              </span>
            </div>
            <div
              className={styles.compareDivider}
              data-lightbox-compare-divider
              data-lightbox-compare-ratio={splitRatio.toFixed(3)}
              style={{ left: box.left + box.width * splitRatio, top: box.top, height: box.height }}
              onPointerDown={startSplitDrag}
              /** 再拦一道 click：万一手柄被别的东西接走 pointerup，也不会冒到舞台去关灯箱 */
              onClick={(e) => e.stopPropagation()}
            >
              <span className={styles.compareKnob} />
            </div>
          </>
        )}
        {/*
          * 标注画布（2026-10-16 从独立的全屏标注层搬进灯箱，见 store 的 `openAnnotateEditor`）。
          *
          * 它与灯箱那张图**同一块矩形**（都用 `box`，连那 1px 描边都一样）：两边「指定的
          * 宽高 + 描边」完全相同，于是内容框在任何 `box-sizing` 下都对得上 —— 标注坐标
          * 天然就是图片像素，缩放 / 平移时跟着图一起走，保存时一次换算都不用做。
          * `width/height` **属性**给的是原图像素，CSS 那对宽高才是屏幕尺寸。
          *
          * 它盖在图上，所以只在这里接管左键（画）；中键照旧冒到舞台那条通用平移去。
          */}
        {annotating && box && natural && (
          <canvas
            ref={annCanvasRef}
            className={styles.annotateCanvas}
            data-annotate-layer
            data-annotate-canvas
            style={box}
            width={natural.w}
            height={natural.h}
            onPointerDown={onAnnDown}
            onPointerMove={onAnnMove}
            onPointerUp={onAnnUp}
            onPointerCancel={onAnnUp}
            /** 画完一笔松手也会触发 click：别让它冒到舞台去（舞台那条是「单击空白关灯箱」） */
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {annotating && box && vp && (
          <div className={styles.annTextLayer} data-annotate-text-layer>
            {annTextItems.map((item) => {
              const selected = selectedTextId === item.id
              const editing = editingTextId === item.id
              const active = annTool === 'text'
              const lines = item.text.split('\n')
              const fontScreen = item.fontSize * vp.zoom
              return (
                <div
                  key={item.id}
                  className={active ? styles.annTextItemOn : styles.annTextItem}
                  data-annotate-text-item={item.id}
                  data-annotate-text-editing={editing ? 'true' : 'false'}
                  data-annotate-text-selected={selected ? 'true' : 'false'}
                  style={{
                    left: box.left + item.x * vp.zoom,
                    top: box.top + item.y * vp.zoom,
                    color: item.color,
                    fontSize: fontScreen,
                  }}
                  onPointerDown={(e) => startTextMove(e, item)}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    selectTextItem(item.id)
                    setEditingTextId(item.id)
                  }}
                >
                  {editing ? (
                    <textarea
                      className={styles.annTextEditor}
                      data-annotate-text-editor={item.id}
                      value={item.text}
                      autoFocus
                      spellCheck={false}
                      style={{
                        width: Math.max(
                          120,
                          Math.max(...lines.map((line) => line.length), 1) * fontScreen * 0.72 + 16,
                        ),
                        height: lines.length * fontScreen * 1.2 + 12,
                      }}
                      onChange={(e) => patchTextItem(item.id, { text: e.target.value })}
                      onFocus={(e) => e.currentTarget.select()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        setEditingTextId(null)
                        if (!e.currentTarget.value.trim()) deleteTextItem(item.id)
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' || e.shiftKey) return
                        e.preventDefault()
                        e.currentTarget.blur()
                      }}
                    />
                  ) : (
                    <span className={selected ? styles.annTextBodyOn : styles.annTextBody}>
                      {item.text}
                    </span>
                  )}
                  {selected && active && !editing ? (
                    <span
                      className={styles.annTextResize}
                      data-annotate-text-resize={item.id}
                      title="拖动缩放文字"
                      onPointerDown={(e) => startTextResize(e, item)}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
        {/*
          * 手柄与选框**分成两层**：选框那层带 `opacity` 做半透明（主题守卫不许写
          * `rgba`，半透明只能靠 opacity），子元素会连 opacity 一起继承 ——
          * 手柄放进去就淡成 28%，等于看不见。所以手柄另起一层，几何同源。
          */}
        {cropBox && <div className={styles.cropRect} data-lightbox-crop-rect style={cropBox} />}
        {cropBox && (
          <div className={styles.cropHandles} data-lightbox-crop-handles style={cropBox}>
            {/* 框内按下 = 搬框（先铺一层「移动层」，8 个手柄在它上面，压角时手柄优先） */}
            <div
              className={styles.cropMove}
              data-lightbox-crop-move
              onPointerDown={startMove}
            />
            {CROP_HANDLES.map((h) => (
              <span
                key={h}
                className={styles.cropHandle}
                data-lightbox-crop-handle={h}
                style={HANDLE_POS[h]}
                onPointerDown={(e) => startResize(h, e)}
              />
            ))}
          </div>
        )}
      </div>
      {hasGalleryNavigation && mode === 'view' ? (
        <>
          <button
            type="button"
            className={`${styles.galleryNav} ${styles.galleryPrev}`}
            data-lightbox-prev
            title="上一张（←）"
            aria-label="上一张"
            onClick={() => navigateGallery(-1)}
          >
            <IconChevronLeft size={22} />
          </button>
          <button
            type="button"
            className={`${styles.galleryNav} ${styles.galleryNext}`}
            data-lightbox-next
            title="下一张（→）"
            aria-label="下一张"
            onClick={() => navigateGallery(1)}
          >
            <IconChevronRight size={22} />
          </button>
        </>
      ) : null}
      {mode !== 'view' ? (
      <div className={styles.hud}>
        {/*
          * 对比三档：first / split / second 并排；标签由 compareKind 决定
          * （融合结果 = 结果/对比/原图，对比节点 = A·左/对比/B·右）。
          */}
        {mode === 'compare' && compareAvailable && (
          <div className={styles.compareGroup} data-lightbox-compare-group>
            {compareViews.map((v) => (
              <button
                key={v.id}
                type="button"
                className={v.id === view ? styles.compareOn : styles.compareOff}
                data-lightbox-compare={v.id}
                aria-pressed={v.id === view}
                onClick={() => setCompareView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
        {/**
          * **旋转与镜像模式**（2026-10-16 从独立层搬进灯箱）：
          * 用的是灯箱自己那套按钮样式（`.close` / `.compareOff|On` / `.confirm`），
          * 与前后的「提取选区」条、对比三档同一口径 —— 这就是用户要的「统一设计」。
          */}
        {rotating ? (
          <div className={styles.cropBar} data-rotate-toolbar>
            <button
              type="button"
              className={styles.editorClose}
              data-rotate-close
              title="返回查看"
              aria-label="返回查看"
              onClick={() => setMode('view')}
            >
              <IconClose size={16} />
              <span>旋转与镜像</span>
            </button>
            <span className={styles.barDivider} />
            <button
              type="button"
              className={styles.editorTool}
              data-rotate-left
              title={`逆时针转 ${rotateStep}°`}
              aria-label="逆时针转"
              onClick={() => setAngle((a) => a - rotateStep)}
            >
              <IconUndo size={16} />
            </button>
            <span className={styles.editorAngle} data-rotate-angle>
              {normalizedAngle}°
            </span>
            <button
              type="button"
              className={styles.editorTool}
              data-rotate-right
              title={`顺时针转 ${rotateStep}°`}
              aria-label="顺时针转"
              onClick={() => setAngle((a) => a + rotateStep)}
            >
              <IconRedo size={16} />
            </button>
            <label className={styles.editorStepWrap}>
              <span className={styles.ratioLabel}>步长</span>
              <input
                className={styles.editorStep}
                data-rotate-step
                type="number"
                min={1}
                max={180}
                step={1}
                value={rotateStep}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n) && n >= 1 && n <= 180) setRotateStep(Math.round(n))
                }}
              />
              <span className={styles.ratioLabel}>°</span>
            </label>
            <span className={styles.barDivider} />
            <button
              type="button"
              className={mirrorH ? styles.editorToolOn : styles.editorTool}
              data-rotate-mirror-h
              aria-pressed={mirrorH}
              title="左右镜像"
              onClick={() => setMirrorH((v) => !v)}
            >
              <IconMirrorH size={16} />
            </button>
            <button
              type="button"
              className={mirrorV ? styles.editorToolOn : styles.editorTool}
              data-rotate-mirror-v
              aria-pressed={mirrorV}
              title="上下镜像"
              onClick={() => setMirrorV((v) => !v)}
            >
              <IconMirrorV size={16} />
            </button>
            <span className={styles.barDivider} />
            <button
              type="button"
              className={styles.editorSave}
              data-rotate-save
              disabled={rotating2}
              onClick={() => void saveRotation()}
            >
              <IconCheck size={16} />
              <span>{rotating2 ? '保存中…' : '保存'}</span>
            </button>
          </div>
        ) : annotating ? (
          /**
           * **标注模式**（2026-10-16 从独立的全屏标注层搬进灯箱）。
           *
           * 工具条按用户列的顺序排，一个不少：✕ / 画笔 / 矩形 / 文字 / 颜色 / 粗细 /
           * 撤销 / 重做 / 保存。控件全部复用灯箱自己那套（`.compareOff` / `.compareOn`
           * / `.close` / `.confirm`），与前后的「提取选区」条、旋转条同一口径 ——
           * 这就是用户要的「统一设计」。
           */
          <div className={styles.cropBar} data-annotate-toolbar>
            <button
              type="button"
              className={styles.editorClose}
              data-annotate-close
              title="返回查看"
              aria-label="返回查看"
              onClick={() => setMode('view')}
            >
              <IconClose size={16} />
              <span>标注</span>
            </button>
            <span className={styles.barDivider} />
            {ANNOTATE_TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={t.id === annTool ? styles.editorToolOn : styles.editorTool}
                data-annotate-tool={t.id}
                aria-pressed={t.id === annTool}
                aria-label={t.label}
                title={t.label}
                onClick={() => setAnnTool(t.id)}
              >
                {t.icon}
              </button>
            ))}
            <span className={styles.barDivider} />
            {/* 颜色：固定色板（圆点即色样，选中的加一圈环） */}
            {ANNOTATE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={c === annColor ? styles.swatchOn : styles.swatch}
                data-annotate-color={c}
                aria-pressed={c === annColor}
                aria-label={`颜色 ${c}`}
                style={{ background: c }}
                onClick={() => {
                  setAnnColor(c)
                  if (selectedTextId) patchTextItem(selectedTextId, { color: c })
                }}
              />
            ))}
            {/* 粗细：画笔 / 矩形描边共用一条滑杆（用户原话：「画笔/矩形描边的大小」） */}
            <label className={styles.annSizeWrap}>
              <span className={styles.ratioLabel}>{annTool === 'text' ? '字号' : '粗细'}</span>
              <input
                className={styles.annSize}
                data-annotate-size
                type="range"
                min={2}
                max={48}
                value={
                  annTool === 'text' && selectedTextItem
                    ? Math.min(48, Math.max(2, Math.round(selectedTextItem.fontSize / 5)))
                    : annSize
                }
                onChange={(e) => {
                  const next = Number(e.target.value)
                  setAnnSize(next)
                  if (annTool === 'text' && selectedTextId) {
                    patchTextItem(selectedTextId, { fontSize: Math.max(14, next * 5) })
                  }
                }}
              />
              <span className={styles.annSizeValue}>
                {annTool === 'text' && selectedTextItem
                  ? clampAnnotateTextSize(selectedTextItem.fontSize)
                  : annSize}
              </span>
            </label>
            <span className={styles.barDivider} />
            <button
              type="button"
              className={styles.editorTool}
              data-annotate-tool="undo"
              aria-label="撤销"
              title="撤销"
              disabled={annOps.length === 0}
              onClick={undoAnn}
            >
              <IconUndo size={16} />
            </button>
            <button
              type="button"
              className={styles.editorTool}
              data-annotate-tool="redo"
              aria-label="重做"
              title="重做"
              disabled={annUndone.length === 0}
              onClick={redoAnn}
            >
              <IconRedo size={16} />
            </button>
            <button
              type="button"
              className={styles.editorTool}
              data-annotate-text-delete
              aria-label="删除选中的文字"
              title="删除选中的文字"
              disabled={!selectedTextItem}
              onClick={() => {
                if (selectedTextId) deleteTextItem(selectedTextId)
              }}
            >
              <IconDelete size={16} />
            </button>
            <span className={styles.barDivider} />
            <button
              type="button"
              className={styles.editorSave}
              data-annotate-save
              disabled={annSaving}
              onClick={() => void saveAnnotation()}
            >
              <IconCheck size={16} />
              <span>{annSaving ? '保存中…' : '保存'}</span>
            </button>
          </div>
        ) : cropping ? (
          /**
           * 比例档与两个按钮**放在同一组里**（用户 2026-09-30：「提取选区按钮与比例档
           * 要放在一起」，首版被中间的 spacer 拆到左右两头，眼睛要来回跳）。
           *
           * **框脸模式没有比例档**：那是「裁出来那张图的长宽比」的参数，对一个
           * 「告诉你脸在哪」的框没有意义，比例吸附反而会把框拉扁。
           */
          <div className={styles.cropBar} data-lightbox-crop-bar>
            {!faceFor && (
              <>
                <span className={styles.ratioLabel}>比例</span>
                {RATIO_CHOICES.map((c) => (
                  <button
                    key={c.value || 'free'}
                    type="button"
                    className={c.value === cropRatio ? styles.ratioActive : styles.ratio}
                    data-lightbox-crop-ratio={c.value || 'free'}
                    aria-pressed={c.value === cropRatio}
                    onClick={() => {
                      setCropRatio(c.value)
                      const v = ratioValueOf(c.value)
                      // 已经画好的框跟着新比例**就地吸附**（只缩不放），不用重画
                      if (cropRect) setCropRect(lockCrop(v ? fitRectToRatio(cropRect, v) : cropRect))
                    }}
                  >
                    {c.label}
                  </button>
                ))}
                <span className={styles.barDivider} />
              </>
            )}
            {plainCrop && !faceFor && (
              <span className={styles.cropHint} data-lightbox-crop-hint>
                裁剪不带选区上下文，融不回原图
              </span>
            )}
            <button
              type="button"
              className={styles.editorClose}
              data-lightbox-crop-cancel
              onClick={() => setMode('view')}
            >
              取消
            </button>
            <button
              type="button"
              className={styles.editorSave}
              data-lightbox-crop-apply
              disabled={!canConfirm || busy}
              title={
                canConfirm
                  ? faceFor
                    ? '用这个框当这张脸的位置，回到面板点「生成」'
                    : plainCrop
                      ? '按当前框裁下这一块（不带选区上下文，不能当融合节点的局部修改图）'
                      : '按当前框提取局部图，并保留上下文'
                  : `先在图上拖一个框（短边至少 ${FUSION_MIN_EDGE}px）`
              }
              onClick={() => void confirmCrop()}
            >
              {busy
                ? plainCrop
                  ? '裁剪中…'
                  : '提取中…'
                : faceFor
                  ? '用这个框'
                  : plainCrop
                    ? '裁剪'
                    : '提取选区'}
            </button>
          </div>
        ) : null}
      </div>
      ) : null}
      {hasGalleryNavigation && mode === 'view' ? (
        <div
          className={styles.galleryStrip}
          data-lightbox-thumbnails
          onPointerDown={(event) => event.stopPropagation()}
        >
          {gallery.map((item, index) => (
            <GalleryThumb
              key={`${item.nodeId}:${item.assetHash}`}
              item={item}
              index={index}
              active={index === galleryIndex}
              onSelect={store.selectLightboxIndex}
            />
          ))}
        </div>
      ) : null}
      {/*
       * 固定底栏：左侧像素 / 缩放，中间是能力切换，右侧是最常用的下载 / 关闭。
       * 上方只留给当前编辑器的完整工具条，和旧版全屏编辑器保持同一种阅读顺序。
       */}
      <div className={styles.bottomBar} data-lightbox-bottom-bar>
        <div className={styles.bottomLeft}>
          {hasGalleryNavigation ? (
            <span
              className={styles.chip}
              data-lightbox-gallery-counter
              aria-live="polite"
              title={galleryItem?.title}
            >
              {galleryIndex + 1} / {gallery.length}
            </span>
          ) : null}
          <span className={styles.chip} data-lightbox-size>
            {natural ? `${natural.w} × ${natural.h}` : '—'}
          </span>
          <span className={styles.chip} data-lightbox-zoom>
            {vp ? `${Math.round(vp.zoom * 100)}%` : '—'}
          </span>
        </div>
        <div className={styles.modeBar} data-lightbox-mode-bar>
          {availableModes.map((m) => (
            <button
              key={m.id}
              type="button"
              className={mode === m.id ? styles.modeBtnOn : styles.modeBtn}
              data-lightbox-mode-button={m.id}
              aria-pressed={mode === m.id}
              onClick={() => setMode(m.id)}
            >
              {m.icon}
              <span>
                {m.id === 'extract'
                  ? '提取选区'
                  : m.id === 'crop'
                    ? '裁剪'
                    : m.id === 'face'
                      ? '框脸'
                      : m.label}
              </span>
            </button>
          ))}
        </div>
        <div className={styles.bottomRight}>
          <button
            type="button"
            className={styles.close}
            data-lightbox-download
            onClick={() => void download()}
          >
            {downloaded ? '已下载' : '下载原图'}
          </button>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            data-lightbox-close
            onClick={close}
          >
            关闭 (Esc)
          </button>
        </div>
      </div>
    </div>
  )
}

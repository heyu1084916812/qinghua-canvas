import {
  lightboxKeyAction,
  type LightboxEditorMode,
} from './lightboxKeyboard'
import { initialEditorModeOf } from './lightboxGallery'
import type { FusionRect } from '../../../domain/canvas/model/node'

export interface LightboxCommandKeyEvent {
  key: string
  editingText: boolean
  preventDefault(): void
}

export interface LightboxRotationInput {
  url: string
  angle: number
  mirrorH: boolean
  mirrorV: boolean
}

export interface LightboxCommandPorts {
  close(): void
  navigateGallery(delta: number): void
  download(assetHash: string, title: string | undefined): Promise<{ ok: boolean }>
  setDownloaded(downloaded: boolean): void
  schedule(callback: () => void, delayMs: number): number
  cancelSchedule(handle: number): void
  focusClose(): void
  subscribeKeydown(listener: (event: LightboxCommandKeyEvent) => void): () => void
  nodeHasComparePair(assetHash: string): boolean
  setMode(mode: LightboxEditorMode): void
  setAngle(angle: number): void
  setMirrorH(mirrorH: boolean): void
  setMirrorV(mirrorV: boolean): void
  resetAnnotation(): void
  setCropRect(rect: FusionRect | null): void
  setCropRatio(ratio: string): void
  prepareRotation(nodeId: string): ((input: LightboxRotationInput) => Promise<void>) | null
  setRotationBusy(busy: boolean): void
  saveAnnotation(nodeId: string, url: string | undefined): Promise<void>
  deleteSelectedTextForKey(key: string): boolean
}

export function createLightboxCommandLifecycle(ports: LightboxCommandPorts) {
  let downloadResetTimer: number | null = null

  const close = () => ports.close()
  const navigateGallery = (delta: number) => ports.navigateGallery(delta)

  const download = async (assetHash: string | undefined, title: string | undefined) => {
    if (!assetHash) return
    const outcome = await ports.download(assetHash, title)
    if (!outcome.ok) return
    ports.setDownloaded(true)
    if (downloadResetTimer !== null) ports.cancelSchedule(downloadResetTimer)
    downloadResetTimer = ports.schedule(() => {
      downloadResetTimer = null
      ports.setDownloaded(false)
    }, 1500)
  }

  const watchKeyboard = (snapshot: {
    assetHash: string | undefined
    mode: LightboxEditorMode
    hasGalleryNavigation: boolean
  }) => {
    if (!snapshot.assetHash) return
    ports.focusClose()
    return ports.subscribeKeydown((event) => {
      const action = lightboxKeyAction({
        key: event.key,
        editingText: event.editingText,
        mode: snapshot.mode,
        hasGalleryNavigation: snapshot.hasGalleryNavigation,
      })
      if (action.kind === 'ignore') return
      event.preventDefault()
      if (action.kind === 'close') close()
      else navigateGallery(action.delta)
    })
  }

  const initializeMode = (snapshot: {
    assetHash: string | undefined
    faceFor: string | undefined
    cropFor: string | undefined
    cropPlain: boolean
    rotateFor: string | undefined
    annotateFor: string | undefined
    compareWith: string | undefined
  }) => {
    if (!snapshot.assetHash) {
      ports.setMode('view')
      return
    }
    ports.setMode(initialEditorModeOf({
      assetHash: snapshot.assetHash,
      faceFor: snapshot.faceFor,
      cropFor: snapshot.cropFor,
      cropPlain: snapshot.cropPlain,
      rotateFor: snapshot.rotateFor,
      annotateFor: snapshot.annotateFor,
      compareWith: snapshot.compareWith,
      nodeHasComparePair: ports.nodeHasComparePair(snapshot.assetHash),
    }))
  }

  const resetRotationEditor = (rotateFor: string | undefined) => {
    if (!rotateFor) return
    ports.setAngle(0)
    ports.setMirrorH(false)
    ports.setMirrorV(false)
    ports.setRotationBusy(false)
  }

  const resetAnnotation = (assetHash: string | undefined) => {
    if (assetHash) ports.resetAnnotation()
  }

  const resetCropSelection = () => {
    ports.setCropRect(null)
    ports.setCropRatio('')
  }

  const watchAnnotationDelete = (snapshot: {
    annotating: boolean
    selectedTextId: string | null
    editingTextId: string | null
  }) => {
    if (!snapshot.annotating || !snapshot.selectedTextId || snapshot.editingTextId) return
    return ports.subscribeKeydown((event) => {
      if (ports.deleteSelectedTextForKey(event.key)) event.preventDefault()
    })
  }

  const saveRotation = async (snapshot: {
    nodeId: string | undefined
    url: string | undefined
    busy: boolean
    angle: number
    mirrorH: boolean
    mirrorV: boolean
  }) => {
    if (!snapshot.nodeId || !snapshot.url || snapshot.busy) return
    const prepare = ports.prepareRotation(snapshot.nodeId)
    if (!prepare) return
    ports.setRotationBusy(true)
    try {
      await prepare({
        url: snapshot.url,
        angle: snapshot.angle,
        mirrorH: snapshot.mirrorH,
        mirrorV: snapshot.mirrorV,
      })
      close()
    } finally {
      ports.setRotationBusy(false)
    }
  }

  const saveAnnotation = (nodeId: string, url: string | undefined) =>
    ports.saveAnnotation(nodeId, url)

  const dispose = () => {
    if (downloadResetTimer === null) return
    ports.cancelSchedule(downloadResetTimer)
    downloadResetTimer = null
  }

  return {
    close,
    navigateGallery,
    download,
    watchKeyboard,
    initializeMode,
    resetRotationEditor,
    resetAnnotation,
    resetCropSelection,
    watchAnnotationDelete,
    saveRotation,
    saveAnnotation,
    dispose,
  }
}

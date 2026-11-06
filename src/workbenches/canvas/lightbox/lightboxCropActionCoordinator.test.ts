import { describe, expect, it, vi } from 'vitest'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import type { FusionRect } from '../../../domain/canvas/model/node'
import {
  createLightboxCropActions,
  type LightboxCropOutcome,
  type LightboxCropPointer,
  type LightboxCropPointerDragHandlers,
  type LightboxCropPorts,
  type LightboxCropState,
} from './lightboxCropActionCoordinator'

const stage: Rect = { x: 10, y: 20, w: 300, h: 200 }

function pointer(overrides: Partial<LightboxCropPointer> = {}): LightboxCropPointer {
  return {
    button: 0,
    clientX: 30,
    clientY: 40,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
    ...overrides,
  }
}

function harness(
  overrides: Partial<LightboxCropState> = {},
  outcomes: { crop?: LightboxCropOutcome; extract?: LightboxCropOutcome } = {},
) {
  const state: LightboxCropState = {
    cropRect: { x: 20, y: 20, w: 40, h: 40 },
    cropRatio: '',
    ratioValue: null,
    natural: { w: 300, h: 200 },
    viewport: { x: 0, y: 0, zoom: 1 },
    faceFor: undefined,
    cropFor: undefined,
    ownerNodeId: 'owner',
    plainCrop: false,
    ...overrides,
  }
  const handlers: LightboxCropPointerDragHandlers[] = []
  const subscribePointerDrag = vi.fn((next: LightboxCropPointerDragHandlers) => {
    handlers.push(next)
    return vi.fn()
  })
  const setCropRect = vi.fn((rect: FusionRect) => {
    state.cropRect = rect
  })
  const setMoved = vi.fn()
  const setBusy = vi.fn()
  const notify = vi.fn()
  const updateFaceBox = vi.fn()
  const crop = vi.fn(async () => outcomes.crop ?? { ok: true as const, nodeId: 'crop-node' })
  const extract = vi.fn(
    async () => outcomes.extract ?? { ok: true as const, nodeId: 'extract-node' },
  )
  const close = vi.fn()
  const ports: LightboxCropPorts = {
    state: () => state,
    stageRect: () => stage,
    setCropRect,
    setMoved,
    setBusy,
    notify,
    updateFaceBox,
    crop,
    extract,
    close,
    subscribePointerDrag,
  }
  return {
    actions: createLightboxCropActions(ports),
    state,
    subscribePointerDrag,
    latestHandlers: () => handlers.at(-1)!,
    setCropRect,
    setMoved,
    setBusy,
    notify,
    updateFaceBox,
    crop,
    extract,
    close,
  }
}

describe('lightboxCropActionCoordinator', () => {
  it('guards move by primary pointer, blocks propagation, and reuses the press-time base', () => {
    const test = harness({
      cropRect: { x: 20, y: 20, w: 40, h: 40 },
      natural: { w: 300, h: 200 },
    })
    const blocked = pointer({ button: 1 })
    test.actions.startMove(blocked)
    expect(blocked.stopPropagation).not.toHaveBeenCalled()
    expect(blocked.preventDefault).not.toHaveBeenCalled()
    expect(test.setMoved).not.toHaveBeenCalled()
    expect(test.subscribePointerDrag).not.toHaveBeenCalled()

    const start = pointer()
    test.actions.startMove(start)
    expect(start.stopPropagation).toHaveBeenCalledOnce()
    expect(start.preventDefault).toHaveBeenCalledOnce()
    expect(test.setMoved).toHaveBeenCalledWith(true)

    test.latestHandlers().onMove({ clientX: 40, clientY: 50 })
    expect(test.setCropRect).toHaveBeenLastCalledWith({ x: 30, y: 30, w: 40, h: 40 })
    test.latestHandlers().onMove({ clientX: 50, clientY: 60 })
    expect(test.setCropRect).toHaveBeenLastCalledWith({ x: 40, y: 40, w: 40, h: 40 })
  })

  it('guards crop and resize, marks framing as moved, and enforces ratio plus min edge', () => {
    const cropTest = harness()
    const blockedCrop = pointer({ button: 2 })
    cropTest.actions.startCrop(blockedCrop)
    expect(blockedCrop.stopPropagation).not.toHaveBeenCalled()
    expect(cropTest.setMoved).not.toHaveBeenCalled()

    const cropStart = pointer()
    cropTest.actions.startCrop(cropStart)
    expect(cropStart.stopPropagation).toHaveBeenCalledOnce()
    expect(cropTest.setMoved).toHaveBeenCalledWith(true)
    cropTest.latestHandlers().onMove({ clientX: 130, clientY: 140 })
    expect(cropTest.setCropRect).toHaveBeenLastCalledWith({ x: 20, y: 20, w: 100, h: 100 })

    const resizeTest = harness({
      cropRect: { x: 20, y: 20, w: 40, h: 40 },
      ratioValue: 1,
    })
    const blockedResize = pointer({ button: 1 })
    resizeTest.actions.startResize('e', blockedResize)
    expect(blockedResize.stopPropagation).not.toHaveBeenCalled()
    expect(resizeTest.subscribePointerDrag).not.toHaveBeenCalled()

    const resizeStart = pointer()
    resizeTest.actions.startResize('e', resizeStart)
    expect(resizeStart.stopPropagation).toHaveBeenCalledOnce()
    expect(resizeStart.preventDefault).toHaveBeenCalledOnce()
    expect(resizeTest.setMoved).toHaveBeenCalledWith(true)
    resizeTest.latestHandlers().onMove({ clientX: 25, clientY: 40 })
    expect(resizeTest.setCropRect).toHaveBeenLastCalledWith({ x: 20, y: 24, w: 32, h: 32 })
  })

  it('replaces an active pointer subscription and cleans each drag exactly once', () => {
    const test = harness()
    test.actions.startMove(pointer())
    const first = test.latestHandlers()
    test.actions.startMove(pointer())
    const second = test.latestHandlers()
    expect(test.subscribePointerDrag).toHaveBeenCalledTimes(2)
    expect(test.subscribePointerDrag.mock.results[0]?.value).toHaveBeenCalledOnce()

    first.onUp()
    expect(test.subscribePointerDrag.mock.results[0]?.value).toHaveBeenCalledOnce()
    second.onUp()
    expect(test.subscribePointerDrag.mock.results[1]?.value).toHaveBeenCalledOnce()
    test.actions.dispose()
    expect(test.subscribePointerDrag.mock.results[1]?.value).toHaveBeenCalledOnce()
  })

  it('rejects an empty face box and keeps face success order', async () => {
    const tooSmall = harness({
      faceFor: 'face-node',
      cropRect: { x: 0, y: 0, w: 0, h: 0 },
      natural: { w: 100, h: 100 },
    })
    await tooSmall.actions.confirmCrop()
    expect(tooSmall.notify).toHaveBeenCalledWith(
      '这个框太小了，重新拖一个大一点的',
      'error',
    )
    expect(tooSmall.updateFaceBox).not.toHaveBeenCalled()
    expect(tooSmall.close).not.toHaveBeenCalled()

    const success = harness({
      faceFor: 'face-node',
      cropRect: { x: 10, y: 20, w: 30, h: 40 },
      natural: { w: 100, h: 100 },
    })
    await success.actions.confirmCrop()
    expect(success.updateFaceBox).toHaveBeenCalledWith('face-node', {
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.4,
    })
    expect(success.updateFaceBox.mock.invocationCallOrder[0]).toBeLessThan(
      success.close.mock.invocationCallOrder[0]!,
    )
    expect(success.close.mock.invocationCallOrder[0]).toBeLessThan(
      success.notify.mock.invocationCallOrder[0]!,
    )
  })

  it('splits plain crop from extract and unlocks busy before success UI', async () => {
    const plain = harness({ plainCrop: true, cropFor: 'crop-target' })
    await plain.actions.confirmCrop()
    expect(plain.crop).toHaveBeenCalledWith({
      nodeId: 'crop-target',
      rect: plain.state.cropRect,
      ratio: '',
    })
    expect(plain.extract).not.toHaveBeenCalled()
    expect(plain.setBusy.mock.calls).toEqual([[true], [false]])
    expect(plain.setBusy.mock.invocationCallOrder[1]).toBeLessThan(
      plain.close.mock.invocationCallOrder[0]!,
    )
    expect(plain.close).toHaveBeenCalledOnce()
    expect(plain.notify).toHaveBeenCalledWith(
      '已裁剪：新图已生成在原图右侧（不带选区上下文）',
    )

    const extract = harness({ plainCrop: false, cropFor: undefined, ownerNodeId: 'owner' })
    await extract.actions.confirmCrop()
    expect(extract.extract).toHaveBeenCalledWith({
      nodeId: 'owner',
      rect: extract.state.cropRect,
      ratio: '',
    })
    expect(extract.crop).not.toHaveBeenCalled()
    expect(extract.close).toHaveBeenCalledOnce()
    expect(extract.notify).toHaveBeenCalledWith(
      '已提取选区：局部图已生成在原图右侧，并带上上下文',
    )
  })

  it('reports crop failure with the reason and never closes the lightbox', async () => {
    const test = harness(
      { plainCrop: true, cropFor: 'crop-target' },
      { crop: { ok: false, reason: '素材读取失败' } },
    )
    await test.actions.confirmCrop()
    expect(test.setBusy.mock.calls).toEqual([[true], [false]])
    expect(test.close).not.toHaveBeenCalled()
    expect(test.notify).toHaveBeenCalledWith('素材读取失败', 'error')

    const extract = harness(
      { plainCrop: false, ownerNodeId: 'owner' },
      { extract: { ok: false, reason: '提取失败' } },
    )
    await extract.actions.confirmCrop()
    expect(extract.extract).toHaveBeenCalledOnce()
    expect(extract.crop).not.toHaveBeenCalled()
    expect(extract.setBusy.mock.calls).toEqual([[true], [false]])
    expect(extract.close).not.toHaveBeenCalled()
    expect(extract.notify).toHaveBeenCalledWith('提取失败', 'error')
  })
})

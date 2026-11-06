import { describe, expect, it, vi } from 'vitest'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import { splitRatioAt } from './lightboxEditState'
import {
  DRAG_SLOP,
  dragPan,
  fitMediaViewport,
  wheelZoom,
  type MediaBox,
} from './lightboxViewportMath'
import {
  createLightboxViewportGestureCoordinator,
  type LightboxViewportGesturePorts,
  type LightboxViewportPointer,
  type LightboxViewportPointerDragHandlers,
  type LightboxViewportWheel,
} from './lightboxViewportGestureCoordinator'

const stage: Rect = { x: 10, y: 20, w: 800, h: 600 }
const viewport = { x: 5, y: 7, zoom: 1.5 }
const mediaBox: MediaBox = { left: 0, top: 0, width: 600, height: 400 }

function pointer(overrides: Partial<LightboxViewportPointer> = {}): LightboxViewportPointer {
  return {
    button: 0,
    clientX: 50,
    clientY: 60,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
    ...overrides,
  }
}

function wheelEvent(overrides: Partial<LightboxViewportWheel> = {}): LightboxViewportWheel {
  return {
    deltaY: -1,
    clientX: 120,
    clientY: 140,
    preventDefault: vi.fn(),
    ...overrides,
  }
}

function harness(overrides: Partial<LightboxViewportGesturePorts> = {}) {
  let currentStage: Rect | null = stage
  let previousHash: string | undefined
  let preserve = false
  const resizeListeners = new Set<() => void>()
  const drags: Array<{
    handlers: LightboxViewportPointerDragHandlers
    release: ReturnType<typeof vi.fn>
  }> = []
  const ports: LightboxViewportGesturePorts = {
    stageRect: () => currentStage,
    setStage: vi.fn((next) => {
      currentStage = next
    }),
    setNatural: vi.fn(),
    setViewport: vi.fn(),
    setCompareView: vi.fn(),
    setSplitRatio: vi.fn(),
    setMoved: vi.fn(),
    previousAssetHash: () => previousHash,
    setPreviousAssetHash: vi.fn((next) => {
      previousHash = next
    }),
    setPreserveViewportAfterMediaLoad: vi.fn((next) => {
      preserve = next
    }),
    preserveViewportAfterMediaLoad: () => preserve,
    clearPreserveViewportAfterMediaLoad: vi.fn(() => {
      preserve = false
    }),
    startCrop: vi.fn(),
    subscribeResize: vi.fn((listener) => {
      resizeListeners.add(listener)
      return () => resizeListeners.delete(listener)
    }),
    subscribePointerDrag: vi.fn((handlers) => {
      const release = vi.fn()
      drags.push({ handlers, release })
      return release
    }),
    ...overrides,
  }
  return {
    actions: createLightboxViewportGestureCoordinator(ports),
    ports,
    resizeListeners,
    drags,
    latestDrag: () => drags.at(-1)!,
    setStageForTest: (next: Rect | null) => {
      currentStage = next
    },
    setPreserveForTest: (next: boolean) => {
      preserve = next
    },
  }
}

describe('lightboxViewportGestureCoordinator', () => {
  it('measures the stage immediately and owns paired resize cleanup', () => {
    const test = harness()
    const stop = test.actions.watchStage('asset-a')

    expect(test.ports.setStage).toHaveBeenCalledWith(stage)
    expect(test.ports.subscribeResize).toHaveBeenCalledOnce()

    test.setStageForTest({ x: 1, y: 2, w: 300, h: 200 })
    for (const listener of test.resizeListeners) listener()
    expect(test.ports.setStage).toHaveBeenLastCalledWith({ x: 1, y: 2, w: 300, h: 200 })

    stop?.()
    expect(test.resizeListeners.size).toBe(0)

    test.actions.watchStage(undefined)
    expect(test.ports.setStage).toHaveBeenLastCalledWith(null)
  })

  it('preserves gallery frame viewport state but resets a new lightbox entry', () => {
    const test = harness()
    test.actions.prepareAssetSwitch('asset-a', true)
    expect(test.ports.setPreviousAssetHash).toHaveBeenLastCalledWith('asset-a')
    expect(test.ports.setNatural).toHaveBeenLastCalledWith(null)
    expect(test.ports.setViewport).toHaveBeenLastCalledWith(null)

    test.actions.prepareAssetSwitch('asset-b', true)
    expect(test.ports.setPreserveViewportAfterMediaLoad).toHaveBeenLastCalledWith(true)
    expect(test.ports.setNatural).toHaveBeenCalledOnce()

    test.actions.prepareAssetSwitch('asset-c', false)
    expect(test.ports.setPreserveViewportAfterMediaLoad).toHaveBeenLastCalledWith(false)
    expect(test.ports.setNatural).toHaveBeenCalledTimes(2)
  })

  it('opens explicit compare pairs on split and resets every other entry to the first view', () => {
    const test = harness()
    test.actions.resetCompareView(true)
    expect(test.ports.setCompareView).toHaveBeenLastCalledWith('split')
    expect(test.ports.setSplitRatio).toHaveBeenLastCalledWith(0.5)

    test.actions.resetCompareView(false)
    expect(test.ports.setCompareView).toHaveBeenLastCalledWith('first')
  })

  it('fits only an unplaced media stage with valid dimensions', () => {
    const test = harness()
    test.actions.fitInitialViewport({ w: 320, h: 240 }, stage, null)
    expect(test.ports.setViewport).toHaveBeenCalledWith(
      fitMediaViewport({ w: 320, h: 240 }, stage),
    )

    test.actions.fitInitialViewport({ w: 320, h: 240 }, stage, viewport)
    test.actions.fitInitialViewport({ w: 320, h: 240 }, { ...stage, w: 0 }, null)
    test.actions.fitInitialViewport(null, stage, null)
    expect(test.ports.setViewport).toHaveBeenCalledOnce()
  })

  it('uses the shared anchor zoom math and forwards preventDefault', () => {
    const test = harness()
    const event = wheelEvent()
    test.actions.wheel(event, viewport)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(test.ports.setViewport).toHaveBeenCalledWith(
      wheelZoom(viewport, event.deltaY, event.clientX, event.clientY, stage),
    )
  })

  it('prioritizes framing for a primary pointer in crop mode', () => {
    const test = harness()
    const event = pointer()
    test.actions.pointerDown(event, { viewport, cropping: true })
    expect(test.ports.startCrop).toHaveBeenCalledWith(event)
    expect(test.ports.setMoved).not.toHaveBeenCalled()
    expect(test.ports.subscribePointerDrag).not.toHaveBeenCalled()
  })

  it('pans from the press snapshot, prevents middle-button autoscroll, and marks movement', () => {
    const test = harness()
    const start = pointer({ button: 1, clientX: 100, clientY: 100 })
    test.actions.pointerDown(start, { viewport, cropping: false })
    expect(start.preventDefault).toHaveBeenCalledOnce()
    expect(test.ports.setMoved).toHaveBeenCalledWith(false)

    const drag = test.latestDrag()
    drag.handlers.onMove({ clientX: 100 + DRAG_SLOP + 1, clientY: 100 })
    expect(test.ports.setMoved).toHaveBeenLastCalledWith(true)
    expect(test.ports.setViewport).toHaveBeenLastCalledWith(
      dragPan(viewport, DRAG_SLOP + 1, 0),
    )

    drag.handlers.onUp()
    expect(drag.release).toHaveBeenCalledOnce()
    test.actions.dispose()
    expect(drag.release).toHaveBeenCalledOnce()
  })

  it('settles media size without fitting when a viewport is already preserved', () => {
    const test = harness()
    test.setPreserveForTest(false)
    test.actions.settleMediaSize(640, 480, null)
    expect(test.ports.setNatural).toHaveBeenCalledWith({ w: 640, h: 480 })
    expect(test.ports.setViewport).not.toHaveBeenCalled()

    test.setPreserveForTest(true)
    test.actions.settleMediaSize(1280, 720, viewport)
    expect(test.ports.clearPreserveViewportAfterMediaLoad).toHaveBeenCalledOnce()
    expect(test.ports.setNatural).toHaveBeenLastCalledWith({ w: 1280, h: 720 })
    expect(test.ports.setViewport).not.toHaveBeenCalled()

    test.setPreserveForTest(true)
    test.actions.settleMediaSize(320, 240, null)
    expect(test.ports.setViewport).toHaveBeenCalledWith(
      fitMediaViewport({ w: 320, h: 240 }, stage),
    )
  })

  it('drags the compare divider from a captured box and releases listeners once', () => {
    const test = harness()
    const start = pointer({ clientX: 100, clientY: 100 })
    test.actions.startSplitDrag(start, { mediaBox, splitRatio: 0.5 })
    expect(start.stopPropagation).toHaveBeenCalledOnce()
    expect(start.preventDefault).toHaveBeenCalledOnce()
    expect(test.ports.setMoved).toHaveBeenCalledWith(true)

    const drag = test.latestDrag()
    drag.handlers.onMove({ clientX: 250, clientY: 180 })
    expect(test.ports.setSplitRatio).toHaveBeenCalledWith(
      splitRatioAt(250, stage, mediaBox, 0.5),
    )

    drag.handlers.onUp()
    drag.handlers.onUp()
    expect(drag.release).toHaveBeenCalledOnce()
  })

  it('replaces an active drag before starting another and disposes only once', () => {
    const test = harness()
    test.actions.pointerDown(pointer(), { viewport, cropping: false })
    const first = test.latestDrag()
    test.actions.startSplitDrag(pointer(), { mediaBox, splitRatio: 0.5 })
    expect(first.release).toHaveBeenCalledOnce()

    const second = test.latestDrag()
    test.actions.dispose()
    test.actions.dispose()
    expect(second.release).toHaveBeenCalledOnce()
  })
})

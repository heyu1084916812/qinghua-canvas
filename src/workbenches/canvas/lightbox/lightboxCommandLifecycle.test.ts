import { describe, expect, it, vi } from 'vitest'
import {
  createLightboxCommandLifecycle,
  type LightboxCommandKeyEvent,
  type LightboxCommandPorts,
  type LightboxRotationInput,
} from './lightboxCommandLifecycle'

function harness(overrides: Partial<LightboxCommandPorts> = {}) {
  const listeners = new Set<(event: LightboxCommandKeyEvent) => void>()
  const timers = new Map<number, () => void>()
  let nextTimer = 1
  const ports: LightboxCommandPorts = {
    close: vi.fn(),
    navigateGallery: vi.fn(),
    download: vi.fn(async () => ({ ok: true as const })),
    setDownloaded: vi.fn(),
    schedule: vi.fn((callback) => {
      const handle = nextTimer++
      timers.set(handle, callback)
      return handle
    }),
    cancelSchedule: vi.fn((handle) => {
      timers.delete(handle)
    }),
    focusClose: vi.fn(),
    subscribeKeydown: vi.fn((listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    nodeHasComparePair: vi.fn(() => false),
    setMode: vi.fn(),
    setAngle: vi.fn(),
    setMirrorH: vi.fn(),
    setMirrorV: vi.fn(),
    resetAnnotation: vi.fn(),
    setCropRect: vi.fn(),
    setCropRatio: vi.fn(),
    prepareRotation: vi.fn(() => vi.fn(async () => undefined)),
    setRotationBusy: vi.fn(),
    saveAnnotation: vi.fn(async () => undefined),
    deleteSelectedTextForKey: vi.fn(() => false),
    ...overrides,
  }
  return {
    actions: createLightboxCommandLifecycle(ports),
    ports,
    listeners,
    timers,
    latestListener: () => [...listeners].at(-1)!,
  }
}

function keyEvent(overrides: Partial<LightboxCommandKeyEvent> = {}): LightboxCommandKeyEvent {
  return {
    key: 'Escape',
    editingText: false,
    preventDefault: vi.fn(),
    ...overrides,
  }
}

describe('lightboxCommandLifecycle', () => {
  it('delegates close and gallery navigation to host commands', () => {
    const test = harness()
    test.actions.close()
    test.actions.navigateGallery(-1)
    expect(test.ports.close).toHaveBeenCalledOnce()
    expect(test.ports.navigateGallery).toHaveBeenCalledWith(-1)
  })

  it('downloads only with an asset and resets the transient label once', async () => {
    const test = harness()
    await test.actions.download(undefined, 'ignored')
    expect(test.ports.download).not.toHaveBeenCalled()

    await test.actions.download('asset-a', '结果')
    expect(test.ports.download).toHaveBeenCalledWith('asset-a', '结果')
    expect(test.ports.setDownloaded).toHaveBeenCalledWith(true)
    expect(test.timers.size).toBe(1)

    for (const callback of test.timers.values()) callback()
    expect(test.ports.setDownloaded).toHaveBeenLastCalledWith(false)
    expect(test.timers.size).toBe(1)
    test.actions.dispose()
    expect(test.ports.cancelSchedule).not.toHaveBeenCalled()
  })

  it('does not schedule feedback when download fails', async () => {
    const test = harness({ download: vi.fn(async () => ({ ok: false })) })
    await test.actions.download('asset-a', undefined)
    expect(test.ports.setDownloaded).not.toHaveBeenCalled()
    expect(test.ports.schedule).not.toHaveBeenCalled()
  })

  it('focuses close and installs the current keyboard command snapshot', () => {
    const test = harness()
    const stop = test.actions.watchKeyboard({
      assetHash: 'asset-a',
      mode: 'view',
      hasGalleryNavigation: true,
    })
    expect(test.ports.focusClose).toHaveBeenCalledOnce()

    const closeEvent = keyEvent()
    test.latestListener()(closeEvent)
    expect(closeEvent.preventDefault).toHaveBeenCalledOnce()
    expect(test.ports.close).toHaveBeenCalledOnce()

    const nextEvent = keyEvent({ key: 'ArrowRight' })
    test.latestListener()(nextEvent)
    expect(test.ports.navigateGallery).toHaveBeenCalledWith(1)

    const ignored = keyEvent({ editingText: true })
    test.latestListener()(ignored)
    expect(ignored.preventDefault).not.toHaveBeenCalled()
    stop?.()
    expect(test.listeners.size).toBe(0)
  })

  it('skips keyboard installation while the lightbox is closed', () => {
    const test = harness()
    test.actions.watchKeyboard({
      assetHash: undefined,
      mode: 'view',
      hasGalleryNavigation: false,
    })
    expect(test.ports.focusClose).not.toHaveBeenCalled()
    expect(test.ports.subscribeKeydown).not.toHaveBeenCalled()
  })

  it('initializes the requested editor mode and resets command-owned editor state', () => {
    const test = harness({ nodeHasComparePair: vi.fn(() => true) })
    test.actions.initializeMode({
      assetHash: 'asset-a',
      faceFor: undefined,
      cropFor: undefined,
      cropPlain: false,
      rotateFor: undefined,
      annotateFor: undefined,
      compareWith: undefined,
    })
    expect(test.ports.nodeHasComparePair).toHaveBeenCalledWith('asset-a')
    expect(test.ports.setMode).toHaveBeenLastCalledWith('compare')

    test.actions.initializeMode({
      assetHash: undefined,
      faceFor: undefined,
      cropFor: undefined,
      cropPlain: false,
      rotateFor: undefined,
      annotateFor: undefined,
      compareWith: undefined,
    })
    expect(test.ports.setMode).toHaveBeenLastCalledWith('view')

    test.actions.resetRotationEditor('rotate-node')
    expect(test.ports.setAngle).toHaveBeenCalledWith(0)
    expect(test.ports.setMirrorH).toHaveBeenCalledWith(false)
    expect(test.ports.setMirrorV).toHaveBeenCalledWith(false)
    expect(test.ports.setRotationBusy).toHaveBeenCalledWith(false)

    test.actions.resetAnnotation('asset-a')
    expect(test.ports.resetAnnotation).toHaveBeenCalledOnce()
    test.actions.resetCropSelection()
    expect(test.ports.setCropRect).toHaveBeenCalledWith(null)
    expect(test.ports.setCropRatio).toHaveBeenCalledWith('')
  })

  it('installs annotation deletion only for a selected text that is not being edited', () => {
    const deleteText = vi.fn(() => true)
    const test = harness({ deleteSelectedTextForKey: deleteText })
    expect(test.actions.watchAnnotationDelete({
      annotating: false,
      selectedTextId: 'text-a',
      editingTextId: null,
    })).toBeUndefined()

    test.actions.watchAnnotationDelete({
      annotating: true,
      selectedTextId: null,
      editingTextId: null,
    })
    expect(test.ports.subscribeKeydown).not.toHaveBeenCalled()

    test.actions.watchAnnotationDelete({
      annotating: true,
      selectedTextId: 'text-a',
      editingTextId: null,
    })
    const event = keyEvent({ key: 'Delete' })
    test.latestListener()(event)
    expect(deleteText).toHaveBeenCalledWith('Delete')
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('guards rotation, owns busy/finally and closes only after success', async () => {
    let finish: (() => void) | undefined
    const execute = vi.fn((input: LightboxRotationInput) =>
      new Promise<void>((resolve) => {
        finish = () => {
          expect(input).toEqual({
            url: 'blob:image',
            angle: 90,
            mirrorH: true,
            mirrorV: false,
          })
          resolve()
        }
      }))
    const test = harness({ prepareRotation: vi.fn(() => execute) })
    const pending = test.actions.saveRotation({
      nodeId: 'node-a',
      url: 'blob:image',
      busy: false,
      angle: 90,
      mirrorH: true,
      mirrorV: false,
    })
    expect(test.ports.setRotationBusy).toHaveBeenNthCalledWith(1, true)
    finish?.()
    await pending
    expect(test.ports.setRotationBusy).toHaveBeenNthCalledWith(1, true)
    expect(test.ports.setRotationBusy).toHaveBeenNthCalledWith(2, false)
    expect(test.ports.close).toHaveBeenCalledOnce()
  })

  it('does not busy or close when rotation has no target or execution fails', async () => {
    const missing = harness({ prepareRotation: vi.fn(() => null) })
    await missing.actions.saveRotation({
      nodeId: 'node-a',
      url: 'blob:image',
      busy: false,
      angle: 0,
      mirrorH: false,
      mirrorV: false,
    })
    expect(missing.ports.setRotationBusy).not.toHaveBeenCalled()
    expect(missing.ports.close).not.toHaveBeenCalled()

    const failed = harness({
      prepareRotation: vi.fn(() => vi.fn(async () => { throw new Error('bake failed') })),
    })
    await expect(failed.actions.saveRotation({
      nodeId: 'node-a',
      url: 'blob:image',
      busy: false,
      angle: 0,
      mirrorH: false,
      mirrorV: false,
    })).rejects.toThrow('bake failed')
    expect(failed.ports.setRotationBusy).toHaveBeenNthCalledWith(1, true)
    expect(failed.ports.setRotationBusy).toHaveBeenNthCalledWith(2, false)
    expect(failed.ports.close).not.toHaveBeenCalled()
  })

  it('delegates annotation save and clears a pending download timer on dispose', async () => {
    const test = harness()
    await test.actions.saveAnnotation('node-a', 'blob:image')
    expect(test.ports.saveAnnotation).toHaveBeenCalledWith('node-a', 'blob:image')

    await test.actions.download('asset-a', '结果')
    const [handle] = test.timers.keys()
    test.actions.dispose()
    expect(test.ports.cancelSchedule).toHaveBeenCalledWith(handle)
    test.actions.dispose()
    expect(test.ports.cancelSchedule).toHaveBeenCalledOnce()
  })
})

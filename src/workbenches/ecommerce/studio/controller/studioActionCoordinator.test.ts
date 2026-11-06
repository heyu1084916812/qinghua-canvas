import { describe, expect, it, vi } from 'vitest'
import { ECOMMERCE_NOTE_MAX } from '../../../../domain/ecommerce/prompt'
import type { EcommerceRequest } from '../../../../domain/ecommerce/types'
import {
  STUDIO_MODES,
  type EcommerceResultItem,
  type EcommerceUpload,
} from '../studioContracts'
import { studioUploadFailureMessage } from './studioResultActionCoordinator'
import {
  createStudioActions,
  type StudioActionPorts,
  type StudioActionState,
} from './studioActionCoordinator'

const upload = (nodeId: string): EcommerceUpload => ({
  nodeId,
  hash: nodeId,
  preview: null,
})

const result = (
  nodeId: string,
  status: EcommerceResultItem['status'] = 'done',
  mime = 'image/png',
): EcommerceResultItem => ({ nodeId, status, mime })

const fileList = (...files: File[]): FileList => (
  Object.assign([...files], {
    item: (index: number) => files[index] ?? null,
  }) as unknown as FileList
)

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

const imageMode = STUDIO_MODES.find((mode) => mode.mediaKind === 'image')!
const videoMode = STUDIO_MODES.find((mode) => mode.mediaKind === 'video')!

function actionState(overrides: Partial<StudioActionState> = {}): StudioActionState {
  return {
    request: {} as EcommerceRequest,
    mode: imageMode,
    products: [upload('p1')],
    references: [upload('r1')],
    note: 'draft note',
    batchWhite: false,
    productLimit: 4,
    running: false,
    firstUpscaleProfile: 'standard',
    resultLabel: 'target',
    uploadReadFailure: 'read failed',
    emptySellingPointsError: 'empty selling points',
    editTarget: null,
    editInstruction: '',
    editReference: null,
    editModel: '',
    batchInstruction: '',
    results: [],
    selectedEditNodes: new Set(),
    batchReference: null,
    batchEditModel: '',
    upscaleTarget: null,
    upscaleProfile: 'standard',
    upscaleScale: '4x',
    ...overrides,
  }
}

function actionPorts(overrides: Partial<StudioActionPorts> = {}): StudioActionPorts {
  return {
    onUpload: vi.fn(async (_file, kind) => upload(kind === 'product' ? 'p2' : 'r2')),
    onGenerate: vi.fn(async () => {}),
    onModelChange: vi.fn(),
    setModeId: vi.fn(),
    setCategory: vi.fn(),
    setUsage: vi.fn(),
    setModeOptionsByMode: vi.fn(),
    setModeStates: vi.fn(),
    setError: vi.fn(),
    setProducts: vi.fn(),
    setReferences: vi.fn(),
    setDragOver: vi.fn(),
    setWritingSellingPoints: vi.fn(),
    setSellingPointsError: vi.fn(),
    setNote: vi.fn(),
    setEditTarget: vi.fn(),
    setEditInstruction: vi.fn(),
    setEditModel: vi.fn(),
    setEditReference: vi.fn(),
    setEditError: vi.fn(),
    setEditSubmitting: vi.fn(),
    setEditReferenceBusy: vi.fn(),
    setBatchEditOpen: vi.fn(),
    setBatchInstruction: vi.fn(),
    setBatchEditError: vi.fn(),
    setBatchEditSubmitting: vi.fn(),
    setBatchEditModel: vi.fn(),
    setBatchReference: vi.fn(),
    setBatchReferenceBusy: vi.fn(),
    setSelectedEditNodes: vi.fn(),
    setUpscaleTarget: vi.fn(),
    setUpscaleProfile: vi.fn(),
    setUpscaleScale: vi.fn(),
    setUpscaleSubmitting: vi.fn(),
    setUpscaleError: vi.fn(),
    setConfirming: vi.fn(),
    ...overrides,
  }
}

function setup(
  stateOverrides: Partial<StudioActionState> = {},
  portOverrides: Partial<StudioActionPorts> = {},
) {
  const state = actionState(stateOverrides)
  const ports = actionPorts(portOverrides)
  return { state, ports, actions: createStudioActions(state, ports) }
}

describe('studio action coordinator', () => {
  it('clears the model only when activateMode crosses media kind', () => {
    const sameKind = STUDIO_MODES.find(
      (mode) => mode.mediaKind === imageMode.mediaKind && mode.id !== imageMode.id,
    )!
    const first = setup()
    first.actions.activateMode(sameKind)
    expect(first.ports.setModeId).toHaveBeenCalledWith(sameKind.id)
    expect(first.ports.setCategory).toHaveBeenCalledWith(sameKind.category)
    expect(first.ports.setUsage).toHaveBeenCalledWith(sameKind.usage)
    expect(first.ports.setModeOptionsByMode).toHaveBeenCalledOnce()
    expect(first.ports.setModeStates).toHaveBeenCalledOnce()
    expect(first.ports.setError).toHaveBeenCalledWith('')
    expect(first.ports.onModelChange).not.toHaveBeenCalled()

    const second = setup()
    second.actions.activateMode(videoMode)
    expect(second.ports.onModelChange).toHaveBeenCalledOnce()
    expect(second.ports.onModelChange).toHaveBeenCalledWith('')
  })

  it('keeps product/reference upload failure, capacity, and dedupe behavior', async () => {
    const failed = setup({}, { onUpload: vi.fn(async () => null) })
    await failed.actions.onPick(new File(['x'], 'bad.png'), 'product')
    expect(vi.mocked(failed.ports.setError).mock.calls).toEqual([[''], ['read failed']])
    expect(failed.ports.setProducts).not.toHaveBeenCalled()
    expect(failed.ports.setReferences).not.toHaveBeenCalled()

    const products = setup({
      batchWhite: false,
      products: [upload('p1'), upload('p2'), upload('p3')],
      references: [upload('r1')],
      productLimit: 3,
    })
    await products.actions.onPick(new File(['x'], 'p4.png'), 'product')
    const productUpdate = vi.mocked(products.ports.setProducts).mock.calls[0]?.[0]
    expect(productUpdate?.([
      upload('p1'),
      upload('p2'),
      upload('p3'),
    ])).toHaveLength(3)

    const references = setup({
      products: [upload('p1')],
      references: [upload('r1'), upload('r2'), upload('r3')],
    })
    await references.actions.onPick(new File(['x'], 'r4.png'), 'reference')
    const referenceUpdate = vi.mocked(references.ports.setReferences).mock.calls[0]?.[0]
    expect(referenceUpdate?.([
      upload('r1'),
      upload('r2'),
      upload('r3'),
    ])).toHaveLength(3)
  })

  it('waits for dropped uploads one at a time and only processes available room', async () => {
    const releases: Array<() => void> = []
    const onUpload = vi.fn((file: File, kind: 'product' | 'reference') =>
      new Promise<EcommerceUpload | null>((resolve) => {
        releases.push(() => resolve(upload(`${kind}-${file.name}`)))
      }),
    )
    const { actions, ports } = setup({
      products: [upload('p1')],
      references: [upload('r1')],
      productLimit: 4,
    }, { onUpload })

    actions.onDropFiles('product', fileList(
      new File(['1'], 'one.png'),
      new File(['2'], 'two.png'),
      new File(['3'], 'three.png'),
    ))
    expect(ports.setDragOver).toHaveBeenCalledWith(null)
    expect(onUpload).toHaveBeenCalledTimes(1)
    expect(onUpload.mock.calls[0]?.[1]).toBe('product')

    releases[0]?.()
    await vi.waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2))
    expect(onUpload.mock.calls[1]?.[1]).toBe('product')
    releases[1]?.()
    await vi.waitFor(() => expect(ports.setProducts).toHaveBeenCalledTimes(2))
    expect(onUpload).toHaveBeenCalledTimes(2)
  })

  it('routes reference drops through the remaining reference capacity', async () => {
    const { actions, ports } = setup({
      products: [upload('p1')],
      references: [upload('r1'), upload('r2')],
    })
    actions.onDropFiles('reference', fileList(
      new File(['1'], 'one.png'),
      new File(['2'], 'two.png'),
    ))
    await vi.waitFor(() => expect(ports.onUpload).toHaveBeenCalledTimes(1))
    expect(vi.mocked(ports.onUpload).mock.calls[0]?.[1]).toBe('reference')
  })

  it('keeps result editor and upscale guards for running, video, and missing options', () => {
    const running = setup({ running: true }, {
      onEditResult: vi.fn(async () => {}),
      onUpscaleResult: vi.fn(async () => {}),
    })
    running.actions.openEditForResult(result('image'))
    running.actions.openUpscaleForResult(result('image'))
    expect(running.ports.setEditTarget).not.toHaveBeenCalled()
    expect(running.ports.setUpscaleTarget).not.toHaveBeenCalled()

    const video = setup({}, {
      onEditResult: vi.fn(async () => {}),
      onUpscaleResult: vi.fn(async () => {}),
    })
    video.actions.openEditForResult(result('video', 'done', 'video/mp4'))
    video.actions.openUpscaleForResult(result('video', 'done', 'video/mp4'))
    expect(video.ports.setEditTarget).not.toHaveBeenCalled()
    expect(video.ports.setUpscaleTarget).not.toHaveBeenCalled()

    const noUpscale = setup({ firstUpscaleProfile: null }, {
      onUpscaleResult: vi.fn(async () => {}),
    })
    noUpscale.actions.openUpscaleForResult(result('image'))
    expect(noUpscale.ports.setUpscaleTarget).not.toHaveBeenCalled()
  })

  it('keeps edit-reference success/failure branch busy state and selected field', async () => {
    const pending = deferred<EcommerceUpload | null>()
    const batch = setup({}, {
      onUpload: vi.fn(() => pending.promise),
    })
    const batchWork = batch.actions.pickEditReference(
      new File(['x'], 'reference.png'),
      true,
    )
    expect(vi.mocked(batch.ports.setBatchReferenceBusy).mock.calls).toEqual([[true]])
    expect(batch.ports.setBatchEditError).toHaveBeenCalledWith('')
    pending.resolve(upload('batch-reference'))
    await batchWork
    expect(batch.ports.setBatchReference).toHaveBeenCalledWith(upload('batch-reference'))
    expect(vi.mocked(batch.ports.setBatchReferenceBusy).mock.calls).toEqual([
      [true],
      [false],
    ])

    const single = setup({}, { onUpload: vi.fn(async () => null) })
    await single.actions.pickEditReference(
      new File(['x'], 'reference.png'),
      false,
    )
    expect(vi.mocked(single.ports.setEditError).mock.calls).toEqual([
      [''],
      [studioUploadFailureMessage()],
    ])
    expect(single.ports.setEditReference).not.toHaveBeenCalled()
    expect(vi.mocked(single.ports.setEditReferenceBusy).mock.calls).toEqual([
      [true],
      [false],
    ])
  })

  it('trims and truncates selling points, reports empty and failed responses, and unlocks', async () => {
    const written = vi.fn()
      .mockResolvedValueOnce('  useful copy  ')
      .mockResolvedValueOnce('x'.repeat(ECOMMERCE_NOTE_MAX + 8))
    const success = setup({}, { onWriteSellingPoints: written })
    await success.actions.writeSellingPoints()
    await success.actions.writeSellingPoints()
    expect(vi.mocked(success.ports.setNote).mock.calls).toEqual([
      ['useful copy'],
      ['x'.repeat(ECOMMERCE_NOTE_MAX)],
    ])
    expect(vi.mocked(success.ports.setWritingSellingPoints).mock.calls).toEqual([
      [true], [false], [true], [false],
    ])

    const empty = setup({}, { onWriteSellingPoints: vi.fn(async () => '   ') })
    await empty.actions.writeSellingPoints()
    expect(empty.ports.setSellingPointsError).toHaveBeenLastCalledWith(
      'empty selling points',
    )
    expect(empty.ports.setWritingSellingPoints).toHaveBeenLastCalledWith(false)

    const failed = setup({}, {
      onWriteSellingPoints: vi.fn(async () => { throw new Error('selling failed') }),
    })
    await failed.actions.writeSellingPoints()
    expect(failed.ports.setSellingPointsError).toHaveBeenLastCalledWith('selling failed')
    expect(failed.ports.setWritingSellingPoints).toHaveBeenLastCalledWith(false)
  })

  it('guards and completes single edit cleanup with finally', async () => {
    const guarded = setup({ editTarget: null })
    const edit = vi.fn(async () => {})
    guarded.ports.onEditResult = edit
    await guarded.actions.submitEdit()
    expect(edit).not.toHaveBeenCalled()

    const pending = deferred<void>()
    const success = setup({
      editTarget: { nodeId: 'result-1', label: 'target' },
      editInstruction: '  improve lighting  ',
      editReference: upload('reference-1'),
      editModel: 'edit-model',
    }, {
      onEditResult: vi.fn(() => pending.promise),
    })
    const work = success.actions.submitEdit()
    expect(success.ports.setEditSubmitting).toHaveBeenCalledWith(true)
    pending.resolve()
    await work
    expect(success.ports.onEditResult).toHaveBeenCalledWith(
      'result-1',
      'improve lighting',
      { referenceNodeId: 'reference-1', model: 'edit-model' },
    )
    expect(success.ports.setEditTarget).toHaveBeenCalledWith(null)
    expect(success.ports.setEditInstruction).toHaveBeenCalledWith('')
    expect(success.ports.setEditReference).toHaveBeenCalledWith(null)
    expect(success.ports.setEditModel).toHaveBeenCalledWith('')
    expect(vi.mocked(success.ports.setEditSubmitting).mock.calls).toEqual([
      [true],
      [false],
    ])

    const failed = setup({
      editTarget: { nodeId: 'result-1', label: 'target' },
      editInstruction: 'change background',
    }, {
      onEditResult: vi.fn(async () => { throw new Error('edit failed') }),
    })
    await failed.actions.submitEdit()
    expect(failed.ports.setEditError).toHaveBeenLastCalledWith('edit failed')
    expect(failed.ports.setEditTarget).not.toHaveBeenCalledWith(null)
    expect(failed.ports.setEditSubmitting).toHaveBeenLastCalledWith(false)
  })

  it('guards, completes, and cleans up batch edit with finally', async () => {
    const pending = deferred<void>()
    const success = setup({
      batchInstruction: '  unify background  ',
      results: [
        result('done-image', 'done'),
        result('running-image', 'running'),
      ],
      selectedEditNodes: new Set(['done-image', 'running-image']),
      batchReference: upload('batch-reference'),
      batchEditModel: 'batch-model',
    }, {
      onEditResults: vi.fn(() => pending.promise),
    })
    const work = success.actions.submitBatchEdit()
    expect(success.ports.setBatchEditSubmitting).toHaveBeenCalledWith(true)
    pending.resolve()
    await work
    expect(success.ports.onEditResults).toHaveBeenCalledWith(
      ['done-image'],
      'unify background',
      { referenceNodeId: 'batch-reference', model: 'batch-model' },
    )
    expect(success.ports.setBatchEditOpen).toHaveBeenCalledWith(false)
    expect(success.ports.setBatchInstruction).toHaveBeenCalledWith('')
    expect(success.ports.setBatchReference).toHaveBeenCalledWith(null)
    expect(success.ports.setBatchEditModel).toHaveBeenCalledWith('')
    expect(success.ports.setSelectedEditNodes).toHaveBeenCalledWith(new Set())
    expect(vi.mocked(success.ports.setBatchEditSubmitting).mock.calls).toEqual([
      [true],
      [false],
    ])

    const guarded = setup({
      batchInstruction: 'edit',
      results: [result('running', 'running')],
      selectedEditNodes: new Set(['running']),
    }, {
      onEditResults: vi.fn(async () => {}),
    })
    await guarded.actions.submitBatchEdit()
    expect(guarded.ports.onEditResults).not.toHaveBeenCalled()
    expect(guarded.ports.setBatchEditError).toHaveBeenCalledOnce()

    const failed = setup({
      batchInstruction: 'edit',
      results: [result('done')],
      selectedEditNodes: new Set(['done']),
    }, {
      onEditResults: vi.fn(async () => { throw new Error('batch failed') }),
    })
    await failed.actions.submitBatchEdit()
    expect(failed.ports.setBatchEditError).toHaveBeenLastCalledWith('batch failed')
    expect(failed.ports.setBatchEditOpen).not.toHaveBeenCalled()
    expect(failed.ports.setBatchEditSubmitting).toHaveBeenLastCalledWith(false)
  })

  it('clears selected nodes only after successful batch upscale and unlocks on failure', async () => {
    const success = setup({
      upscaleTarget: { items: [result('upscale-1')], batch: true },
    }, {
      onUpscaleResult: vi.fn(async () => {}),
    })
    await success.actions.submitUpscale()
    expect(success.ports.onUpscaleResult).toHaveBeenCalledWith(
      'upscale-1',
      'standard',
      '4x',
    )
    expect(success.ports.setSelectedEditNodes).toHaveBeenCalledWith(new Set())
    expect(success.ports.setUpscaleTarget).toHaveBeenCalledWith(null)
    expect(vi.mocked(success.ports.setUpscaleSubmitting).mock.calls).toEqual([
      [true],
      [false],
    ])

    const failed = setup({
      upscaleTarget: { items: [result('upscale-1')], batch: true },
    }, {
      onUpscaleResult: vi.fn(async () => { throw new Error('upscale failed') }),
    })
    await failed.actions.submitUpscale()
    expect(failed.ports.setUpscaleError).toHaveBeenLastCalledWith('upscale failed')
    expect(failed.ports.setUpscaleTarget).not.toHaveBeenCalledWith(null)
    expect(failed.ports.setSelectedEditNodes).not.toHaveBeenCalled()
    expect(failed.ports.setUpscaleSubmitting).toHaveBeenLastCalledWith(false)

    const guarded = setup({ upscaleTarget: null })
    await guarded.actions.submitUpscale()
    expect(guarded.ports.setUpscaleSubmitting).not.toHaveBeenCalled()
  })

  it('closes confirmation even when generation rejects', async () => {
    const { actions, ports } = setup({}, {
      onGenerate: vi.fn(async () => { throw new Error('generation failed') }),
    })
    await actions.confirm()
    expect(ports.setConfirming).toHaveBeenCalledWith(false)
    expect(vi.mocked(ports.setError).mock.calls).toEqual([[''], ['generation failed']])
  })
})

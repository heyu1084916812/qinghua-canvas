import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
import type { PlatformKit } from '../../../../platform/ports'
import type { AssetLibraryStore } from '../../../../state/project/assetLibraryStore'
import { mentionToken } from '../../text/MentionEditor'
import {
  useAgentAttachmentsController,
  type AgentAttachmentsControllerInput,
} from './useAgentAttachmentsController'

const {
  takeHandoff,
  subscribeHandoff,
  importAssetFile,
  isImportableMedia,
  createAssetNode,
  loadAssetUrl,
} = vi.hoisted(() => ({
  takeHandoff: vi.fn(),
  subscribeHandoff: vi.fn(),
  importAssetFile: vi.fn(),
  isImportableMedia: vi.fn(),
  createAssetNode: vi.fn(),
  loadAssetUrl: vi.fn(),
}))

vi.mock('../../../../features/canvas/agentHandoff', () => ({
  takeAgentHandoff: takeHandoff,
  subscribeAgentHandoff: subscribeHandoff,
}))

vi.mock('../../../../features/canvas/importAsset', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../features/canvas/importAsset')
  >('../../../../features/canvas/importAsset')
  return {
    ...actual,
    importAssetFile,
    isImportableMedia,
    createAssetNode,
  }
})

vi.mock('../../../../features/shared/assets/index', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../features/shared/assets/index')
  >('../../../../features/shared/assets/index')
  return { ...actual, loadAssetUrl }
})

type Hook = ReturnType<typeof useAgentAttachmentsController>
const originalRevokeObjectUrl = URL.revokeObjectURL

const session: AgentSession = {
  id: 'session-1',
  projectId: 'project-1',
  title: '会话一',
  channelId: '',
  model: 'GPT-6 Astra',
  messages: [],
  pendingAssetIds: ['old-node'],
  pendingSteers: [],
  queuedTurns: [],
  createdAt: 1,
  updatedAt: 1,
}

function node(id: string) {
  return {
    id,
    projectId: 'project-1',
    type: 'image',
    parentId: null,
    x: 0,
    y: 0,
    w: 240,
    h: 192,
    title: id,
    disabled: false,
    data: {},
  }
}

function input(
  patch: Partial<AgentAttachmentsControllerInput> = {},
): AgentAttachmentsControllerInput {
  const nodes = [node('n1'), node('n2')]
  const store = {
    getSnapshot: () => ({ nodes, edges: [], resultGroups: [] }),
  } as unknown as CanvasStore
  const library = {
    getState: () => ({
      assets: [
        {
          hash: 'hash-library',
          mime: 'image/png',
          width: 800,
          height: 600,
        },
      ],
    }),
  } as unknown as AssetLibraryStore
  return {
    active: true,
    projectId: 'project-1',
    current: session,
    draft: '',
    messages: [],
    nodeHashes: new Map(),
    platform: {} as PlatformKit,
    store,
    viewport: { x: 0, y: 0, zoom: 1 },
    library,
    insertMention: vi.fn(),
    nodeLabelOf: (id) => `节点 ${id}`,
    patchSession: vi.fn(async () => undefined),
    patchSessionDetached: vi.fn(),
    trackRun: <T,>(work: () => Promise<T>) => work(),
    ...patch,
    // Allow tests to mutate placement fixtures through the same store.
    ...(patch.store ? { store: patch.store } : {}),
  }
}

function render(
  props: AgentAttachmentsControllerInput,
): {
  viewRef: { current: Hook | null }
  renderer: TestRenderer.ReactTestRenderer
  update: (next: AgentAttachmentsControllerInput) => void
} {
  const viewRef: { current: Hook | null } = { current: null }
  function Probe() {
    viewRef.current = useAgentAttachmentsController(props)
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(Probe))
  })
  return {
    viewRef,
    renderer,
    update: (next) => {
      act(() => renderer.update(createElement(Probe, next)))
    },
  }
}

describe('useAgentAttachmentsController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    takeHandoff.mockReturnValue([])
    subscribeHandoff.mockReturnValue(vi.fn())
    isImportableMedia.mockReturnValue(true)
    importAssetFile.mockResolvedValue({
      hash: 'hash-file',
      mime: 'image/png',
      width: 640,
      height: 480,
    })
    createAssetNode.mockReturnValue('node-new')
    loadAssetUrl.mockResolvedValue({ url: 'blob:thumb' })
    vi.stubGlobal(
      'window',
      Object.assign(Object.create(Object.prototype), {
        innerWidth: 1200,
        innerHeight: 800,
      }),
    )
    vi.stubGlobal('document', {
      querySelector: () => ({ clientWidth: 1200, clientHeight: 800 }),
    })
  })

  afterEach(() => {
    URL.revokeObjectURL = originalRevokeObjectUrl
    vi.unstubAllGlobals()
  })

  it('画布 handoff 过滤不存在节点、去重并补正文引用', () => {
    takeHandoff.mockReturnValue(['n1', 'missing', 'n1'])
    const insertMention = vi.fn()
    const patchSessionDetached = vi.fn()
    const props = input({ insertMention, patchSessionDetached })
    const { viewRef } = render(props)

    expect(insertMention).toHaveBeenCalledWith('node', 'n1', '节点 n1')
    expect(patchSessionDetached).toHaveBeenCalledWith({
      pendingAssetIds: ['old-node', 'n1'],
    })
    const listener = subscribeHandoff.mock.calls[0]?.[1] as
      | ((ids: readonly string[]) => void)
      | undefined
    act(() => listener?.(['n2']))
    expect(insertMention).toHaveBeenCalledWith('node', 'n2', '节点 n2')
    expect(viewRef.current?.thumbVersion).toBe(0)
  })

  it('素材库添加走同一落位链路并写会话附件', async () => {
    const insertMention = vi.fn()
    const patchSession = vi.fn(async () => undefined)
    const props = input({ insertMention, patchSession })
    const { viewRef } = render(props)

    await act(async () => {
      await viewRef.current!.addFromLibrary('hash-library')
    })

    expect(createAssetNode).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1' }),
      expect.objectContaining({ hash: 'hash-library' }),
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    )
    expect(insertMention).toHaveBeenCalledWith(
      'node',
      'node-new',
      '节点 node-new',
    )
    expect(patchSession).toHaveBeenCalledWith({
      pendingAssetIds: ['old-node', 'node-new'],
    })
  })

  it('本地文件跳过不可导入项，成功项逐个落位', async () => {
    isImportableMedia
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
    const insertMention = vi.fn()
    const patchSession = vi.fn(async () => undefined)
    const props = input({ insertMention, patchSession })
    const { viewRef } = render(props)
    const files = [
      { name: 'skip.txt', type: 'text/plain' },
      { name: 'ok.png', type: 'image/png' },
    ] as unknown as FileList

    await act(async () => {
      await viewRef.current!.attachFiles(files)
    })

    expect(importAssetFile).toHaveBeenCalledTimes(1)
    expect(insertMention).toHaveBeenCalledWith(
      'node',
      'node-new',
      '节点 node-new',
    )
    expect(patchSession).toHaveBeenCalledWith({
      pendingAssetIds: ['old-node', 'node-new'],
    })
  })

  it('草稿、待发送素材和历史消息的节点缩略图只取一次，卸载回收 URL', async () => {
    const revoke = vi.fn()
    URL.revokeObjectURL = revoke
    loadAssetUrl.mockImplementation(async (_platform, hash) => ({
      url: `blob:${hash}`,
    }))
    const props = input({
      draft: mentionToken('node', 'n1', '节点一'),
      messages: [
        {
          role: 'user',
          content: mentionToken('node', 'n3', '节点三'),
          createdAt: 1,
        },
      ],
      nodeHashes: new Map([
        ['n1', 'hash-1'],
        ['old-node', 'hash-2'],
        ['n3', 'hash-3'],
      ]),
    })
    const { viewRef, renderer } = render(props)

    await vi.waitFor(() => {
      expect(viewRef.current?.thumbOf('n1')).toBe('blob:hash-1')
      expect(viewRef.current?.thumbOf('old-node')).toBe('blob:hash-2')
      expect(viewRef.current?.thumbOf('n3')).toBe('blob:hash-3')
    })
    expect(loadAssetUrl).toHaveBeenCalledTimes(3)
    expect(viewRef.current?.thumbVersion).toBe(1)

    act(() => renderer.unmount())
    expect(revoke).toHaveBeenCalledTimes(3)
  })

  /**
   * #919 标定结论（2026-11-04，先跑红再收口）：
   *
   * 三条投递路径都先读**渲染快照** `input.current.pendingAssetIds`、再整字段写回
   * （`sessionStore.updateFields` = `{...latest, ...patch}`）。第二次投递若在第一次
   * 写回之前发起，两次用的就是同一份旧基线 ⇒ **`pendingAssetIds` 只剩最后一条**
   * （实测：文件导入 / 素材库 / 画布投递各丢一条，`['node-1']`+`['node-2']` → `['node-2']`）。
   *
   * 之所以**不**算"静默丢附件"：`insertMention` 在写会话**之前**就把 node chip 插进正文，
   * 而发送链路 `prepareAgentTurnRequest` 取的是
   * `visualNodeIds = union(pendingAssetIds, 正文里的 node mentions)`（`agentTurnRequest.ts:185-195`），
   * chip 会把丢掉的 id 原样补回模型输入。下面这条钉的就是这个兜底底座：
   * 两次快速投递时，**两条 chip 都必须进正文**（这条在改成 store 级原子 append 后仍然成立）。
   */
  function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>((res) => {
      resolve = res
    })
    return { promise, resolve }
  }

  /** 最小会话行：只保留被读写的那个字段，写入即整份覆盖（与真实 store 同语义）。 */
  function table() {
    return { ids: [] as string[] }
  }

  const files = [{ name: 'a.png', type: 'image/png' }] as unknown as FileList

  it('★★ 两次快速投递：两条 chip 都进正文（pendingAssetIds 被覆盖时的兜底）', async () => {
    const gate = deferred()
    const row = table()
    const patchSession = vi.fn(
      async (patch: { pendingAssetIds: string[] }) => {
        await gate.promise
        row.ids = [...patch.pendingAssetIds]
      },
    )
    const insertMention = vi.fn()
    createAssetNode
      .mockReturnValueOnce('node-1')
      .mockReturnValueOnce('node-2')
    const props = input({
      current: { ...session, pendingAssetIds: [] },
      patchSession,
      insertMention,
    })
    const { viewRef } = render(props)

    let first!: Promise<void>
    act(() => {
      first = viewRef.current!.attachFiles(files)
    })
    await act(async () => {
      await vi.waitFor(() =>
        expect(patchSession).toHaveBeenCalledTimes(1),
      )
    })

    let second!: Promise<void>
    act(() => {
      second = viewRef.current!.attachFiles(files)
    })
    await act(async () => {
      await vi.waitFor(() =>
        expect(patchSession).toHaveBeenCalledTimes(2),
      )
    })

    await act(async () => {
      gate.resolve()
      await first
      await second
    })

    // 两次都写了会话（中间没有串行化）；实测最终行里只剩 ['node-2']（见上方结论）
    expect(patchSession).toHaveBeenCalledTimes(2)
    // 兜底底座：两条 chip 都在正文里，发送时会由 mentions 并回视觉输入
    expect(insertMention.mock.calls.map((call) => call[1])).toEqual([
      'node-1',
      'node-2',
    ])
  })

  it('★ 画布投递连发两次：两条 chip 同样都进正文', async () => {
    const gate = deferred()
    const patchSession = vi.fn(
      async (_patch: { pendingAssetIds: string[] }) => {
        await gate.promise
      },
    )
    const patchSessionDetached = vi.fn(
      (patch: { pendingAssetIds: string[] }) => {
        void patchSession(patch)
      },
    )
    const insertMention = vi.fn()
    const props = input({
      current: { ...session, pendingAssetIds: [] },
      patchSession,
      patchSessionDetached,
      insertMention,
    })
    render(props)

    const listener = subscribeHandoff.mock.calls[0]?.[1] as (
      ids: readonly string[],
    ) => void
    act(() => listener(['n1']))
    await act(async () => {
      await vi.waitFor(() =>
        expect(patchSession).toHaveBeenCalledTimes(1),
      )
    })
    act(() => listener(['n2']))
    await act(async () => {
      await vi.waitFor(() =>
        expect(patchSession).toHaveBeenCalledTimes(2),
      )
    })
    await act(async () => {
      gate.resolve()
      await Promise.resolve()
    })
    expect(insertMention.mock.calls.map((call) => call[1])).toEqual([
      'n1',
      'n2',
    ])
  })

  it('★ 投递中途切到 B：写的是发起时的 A（不串会话）', async () => {
    const gate = deferred()
    const rowA = table()
    const rowB = table()
    const patchA = vi.fn(
      async (patch: { pendingAssetIds: string[] }) => {
        await gate.promise
        rowA.ids = [...patch.pendingAssetIds]
      },
    )
    const patchB = vi.fn(
      async (patch: { pendingAssetIds: string[] }) => {
        rowB.ids = [...patch.pendingAssetIds]
      },
    )
    createAssetNode.mockReturnValueOnce('node-1')
    const propsA = input({
      current: { ...session, id: 'session-A', pendingAssetIds: [] },
      patchSession: patchA,
    })
    const propsB = input({
      current: { ...session, id: 'session-B', pendingAssetIds: [] },
      patchSession: patchB,
    })
    const { viewRef, update } = render(propsA)

    let first!: Promise<void>
    act(() => {
      first = viewRef.current!.attachFiles(files)
    })
    await act(async () => {
      await vi.waitFor(() => expect(patchA).toHaveBeenCalledTimes(1))
    })

    update(propsB)
    await act(async () => {
      gate.resolve()
      await first
    })
    expect(patchB).not.toHaveBeenCalled()
    expect(rowB.ids).toEqual([])
    expect(rowA.ids).toEqual(['node-1'])
  })

  it('★ 画布投递中途切到 B：同样写回发起时的 A', async () => {
    const gate = deferred()
    const rowA = table()
    const rowB = table()
    const patchA = vi.fn(
      async (patch: { pendingAssetIds: string[] }) => {
        await gate.promise
        rowA.ids = [...patch.pendingAssetIds]
      },
    )
    const patchB = vi.fn(
      async (patch: { pendingAssetIds: string[] }) => {
        rowB.ids = [...patch.pendingAssetIds]
      },
    )
    const propsA = input({
      current: { ...session, id: 'session-A', pendingAssetIds: [] },
      patchSession: patchA,
      patchSessionDetached: (patch) => {
        void patchA(patch)
      },
    })
    const propsB = input({
      current: { ...session, id: 'session-B', pendingAssetIds: [] },
      patchSession: patchB,
      patchSessionDetached: (patch) => {
        void patchB(patch)
      },
    })
    const { update } = render(propsA)

    const listener = subscribeHandoff.mock.calls[0]?.[1] as (
      ids: readonly string[],
    ) => void
    act(() => listener(['n1']))
    await act(async () => {
      await vi.waitFor(() => expect(patchA).toHaveBeenCalledTimes(1))
    })

    update(propsB)
    await act(async () => {
      gate.resolve()
      await Promise.resolve()
    })
    expect(patchB).not.toHaveBeenCalled()
    expect(rowB.ids).toEqual([])
    expect(rowA.ids).toEqual(['n1'])
  })
})

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
  takeReferenceHandoff,
  subscribeReferenceHandoff,
  importAssetFile,
  isImportableMedia,
  createAssetNode,
  loadAssetUrl,
} = vi.hoisted(() => ({
  takeHandoff: vi.fn(),
  subscribeHandoff: vi.fn(),
  takeReferenceHandoff: vi.fn(),
  subscribeReferenceHandoff: vi.fn(),
  importAssetFile: vi.fn(),
  isImportableMedia: vi.fn(),
  createAssetNode: vi.fn(),
  loadAssetUrl: vi.fn(),
}))

vi.mock('../../../../features/canvas/agentHandoff', () => ({
  takeAgentHandoff: takeHandoff,
  subscribeAgentHandoff: subscribeHandoff,
  takeReferenceAgentHandoff: takeReferenceHandoff,
  subscribeReferenceAgentHandoff: subscribeReferenceHandoff,
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
    appendPendingAssetIds: vi.fn(async (sessionId: string, ids: readonly string[]) => ({
      ...session,
      id: sessionId,
      pendingAssetIds: [...ids],
    })),
    appendPendingAssetIdsDetached: vi.fn(),
    appendReferenceIds: vi.fn(async (sessionId: string, ids: readonly string[]) => ({
      ...session,
      id: sessionId,
      referenceIds: [...ids],
    })),
    applySessionSnapshot: vi.fn(),
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
    takeReferenceHandoff.mockReturnValue([])
    subscribeReferenceHandoff.mockReturnValue(vi.fn())
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
    const appendPendingAssetIdsDetached = vi.fn()
    const props = input({ insertMention, appendPendingAssetIdsDetached })
    const { viewRef } = render(props)

    expect(insertMention).toHaveBeenCalledWith('node', 'n1', '节点 n1')
    // 只交「追加了哪些」，不再交整份列表 —— 整份列表写回就是 #919 的覆盖丢写
    expect(appendPendingAssetIdsDetached).toHaveBeenCalledWith('session-1', ['n1'])
    const listener = subscribeHandoff.mock.calls[0]?.[1] as
      | ((ids: readonly string[]) => void)
      | undefined
    act(() => listener?.(['n2']))
    expect(insertMention).toHaveBeenCalledWith('node', 'n2', '节点 n2')
    expect(viewRef.current?.thumbVersion).toBe(0)
  })

  it('★★ 项目参考 handoff 变成 reference chip，并写入会话持续引用', async () => {
    takeReferenceHandoff.mockReturnValue([
      { id: 'ref-1', label: '品牌标准字' },
    ])
    const insertMention = vi.fn()
    const appendReferenceIds = vi.fn(async (
      sessionId: string,
      ids: readonly string[],
    ) => ({
      ...session,
      id: sessionId,
      referenceIds: [...ids],
    }))
    const applySessionSnapshot = vi.fn()
    render(input({
      insertMention,
      appendReferenceIds,
      applySessionSnapshot,
    }))

    expect(insertMention).toHaveBeenCalledWith(
      'reference',
      'ref-1',
      '品牌标准字',
    )
    await vi.waitFor(() => {
      expect(appendReferenceIds).toHaveBeenCalledWith(
        'session-1',
        ['ref-1'],
      )
      expect(applySessionSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ referenceIds: ['ref-1'] }),
      )
    })
  })

  it('素材库添加走同一落位链路并写会话附件', async () => {
    const insertMention = vi.fn()
    const appendPendingAssetIds = vi.fn(
      async (sessionId: string, ids: readonly string[]) => ({
        ...session,
        id: sessionId,
        pendingAssetIds: [...ids],
      }),
    )
    const applySessionSnapshot = vi.fn()
    const props = input({
      insertMention,
      appendPendingAssetIds,
      applySessionSnapshot,
    })
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
    expect(appendPendingAssetIds).toHaveBeenCalledWith('session-1', [
      'node-new',
    ])
    // 追加结果要回灌面板（list 与 current 都靠它同步）
    expect(applySessionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ pendingAssetIds: ['node-new'] }),
    )
  })

  it('本地文件跳过不可导入项，成功项逐个落位', async () => {
    isImportableMedia
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
    const insertMention = vi.fn()
    const appendPendingAssetIds = vi.fn(
      async (sessionId: string, ids: readonly string[]) => ({
        ...session,
        id: sessionId,
        pendingAssetIds: [...ids],
      }),
    )
    const props = input({ insertMention, appendPendingAssetIds })
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
    expect(appendPendingAssetIds).toHaveBeenCalledWith('session-1', [
      'node-new',
    ])
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

  it('reference chips load and cache thumbnails from the project ledger', async () => {
    const revoke = vi.fn()
    URL.revokeObjectURL = revoke
    loadAssetUrl.mockResolvedValue({ url: 'blob:reference-image' })
    const query = vi.fn(async (table: string) =>
      table === 'referenceItems'
        ? [{
            id: 'ref-1',
            projectId: 'project-1',
            title: '参考一',
            source: 'file',
            kind: 'image',
            assetHash: 'hash-ref-1',
            what: '',
            createdAt: 1,
            updatedAt: 1,
          }]
        : [],
    )
    const { viewRef, renderer } = render(input({
      draft: mentionToken('reference', 'ref-1', '参考一'),
      platform: { storage: { query } } as unknown as PlatformKit,
    }))

    await vi.waitFor(() => {
      expect(viewRef.current?.thumbOf('ref-1')).toBe('blob:reference-image')
    })
    expect(query).toHaveBeenCalledWith('referenceItems', {
      projectId: 'project-1',
    })
    expect(loadAssetUrl).toHaveBeenCalledWith(expect.anything(), 'hash-ref-1')

    act(() => renderer.unmount())
    expect(revoke).toHaveBeenCalledWith('blob:reference-image')
  })

  /**
   * #919 的 P3 与 #921 的修法（同一个坑的两面）：
   *
   * 修前三条投递路径都先读**渲染快照** `input.current.pendingAssetIds`、再整字段写回
   * （`sessionStore.updateFields` = `{...latest, ...patch}`）。第二次投递若在第一次
   * 写回之前发起，两次用的就是同一份旧基线 ⇒ **`pendingAssetIds` 只剩最后一条**
   * （实测：`['node-1']`+`['node-2']` → `['node-2']`）。
   *
   * 修后投递路径只交「这一次追加了哪些 id」，读改写整段搬进
   * `sessionStore.appendPendingAssetIds` 的事务（load → 追加 → 去重 → 写回）。
   * 下面四条钉三件事：
   * ① 控制器**不再**整字段写回（那正是覆盖丢写的入口）；
   * ② 两次快速投递时两条 chip 都进正文（正文 chip 仍是历史数据的兜底：
   *    `visualNodeIds = union(pendingAssetIds, 正文 node mentions)`）；
   * ③ 投递中途切会话，追加的是**发起时**那个会话。
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
    const calls: Array<{ sessionId: string; ids: string[] }> = []
    const appendPendingAssetIds = vi.fn(
      async (sessionId: string, ids: readonly string[]) => {
        calls.push({ sessionId, ids: [...ids] })
        await gate.promise
        return { ...session, id: sessionId, pendingAssetIds: [...ids] }
      },
    )
    const insertMention = vi.fn()
    createAssetNode
      .mockReturnValueOnce('node-1')
      .mockReturnValueOnce('node-2')
    const props = input({
      current: { ...session, pendingAssetIds: [] },
      appendPendingAssetIds,
      insertMention,
    })
    const { viewRef } = render(props)

    let first!: Promise<void>
    act(() => {
      first = viewRef.current!.attachFiles(files)
    })
    await act(async () => {
      await vi.waitFor(() =>
        expect(appendPendingAssetIds).toHaveBeenCalledTimes(1),
      )
    })

    let second!: Promise<void>
    act(() => {
      second = viewRef.current!.attachFiles(files)
    })
    await act(async () => {
      await vi.waitFor(() =>
        expect(appendPendingAssetIds).toHaveBeenCalledTimes(2),
      )
    })

    await act(async () => {
      gate.resolve()
      await first
      await second
    })

    // ① 每次只交自己那一条 —— 没有「旧基线 + 新 id」的整份列表
    expect(calls).toEqual([
      { sessionId: 'session-1', ids: ['node-1'] },
      { sessionId: 'session-1', ids: ['node-2'] },
    ])
    // ② 兜底仍在：两条 chip 都在正文里，发送时会由 mentions 并回视觉输入
    expect(insertMention.mock.calls.map((call) => call[1])).toEqual([
      'node-1',
      'node-2',
    ])
  })

  it('★ 画布投递连发两次：两条 chip 同样都进正文', async () => {
    const detachedCalls: Array<{ sessionId: string; ids: string[] }> = []
    const appendPendingAssetIdsDetached = vi.fn(
      (sessionId: string, ids: readonly string[]) => {
        detachedCalls.push({ sessionId, ids: [...ids] })
      },
    )
    const insertMention = vi.fn()
    const props = input({
      current: { ...session, pendingAssetIds: [] },
      appendPendingAssetIdsDetached,
      insertMention,
    })
    render(props)

    const listener = subscribeHandoff.mock.calls[0]?.[1] as (
      ids: readonly string[],
    ) => void
    act(() => listener(['n1']))
    act(() => listener(['n2']))
    await act(async () => {
      await Promise.resolve()
    })
    expect(detachedCalls).toEqual([
      { sessionId: 'session-1', ids: ['n1'] },
      { sessionId: 'session-1', ids: ['n2'] },
    ])
    expect(insertMention.mock.calls.map((call) => call[1])).toEqual([
      'n1',
      'n2',
    ])
  })

  it('★ 投递中途切到 B：写的是发起时的 A（不串会话）', async () => {
    const gate = deferred()
    const rowA = table()
    const appendA = vi.fn(
      async (sessionId: string, ids: readonly string[]) => {
        await gate.promise
        rowA.ids = [...ids]
        return { ...session, id: sessionId, pendingAssetIds: [...ids] }
      },
    )
    const appendB = vi.fn(
      async (sessionId: string, ids: readonly string[]) => ({
        ...session,
        id: sessionId,
        pendingAssetIds: [...ids],
      }),
    )
    createAssetNode.mockReturnValueOnce('node-1')
    const propsA = input({
      current: { ...session, id: 'session-A', pendingAssetIds: [] },
      appendPendingAssetIds: appendA,
    })
    const propsB = input({
      current: { ...session, id: 'session-B', pendingAssetIds: [] },
      appendPendingAssetIds: appendB,
    })
    const { viewRef, update } = render(propsA)

    let first!: Promise<void>
    act(() => {
      first = viewRef.current!.attachFiles(files)
    })
    await act(async () => {
      await vi.waitFor(() => expect(appendA).toHaveBeenCalledTimes(1))
    })

    update(propsB)
    await act(async () => {
      gate.resolve()
      await first
    })
    // 追加的目标是发起时那个会话，切到 B 不会改口
    expect(appendA).toHaveBeenCalledWith('session-A', ['node-1'])
    expect(appendB).not.toHaveBeenCalled()
    expect(rowA.ids).toEqual(['node-1'])
  })

  it('★ 画布投递中途切到 B：同样写回发起时的 A', async () => {
    const rowA = table()
    const appendA = vi.fn((sessionId: string, ids: readonly string[]) => {
      rowA.ids = [...ids]
      void sessionId
    })
    const appendB = vi.fn()
    const propsA = input({
      current: { ...session, id: 'session-A', pendingAssetIds: [] },
      appendPendingAssetIdsDetached: appendA,
    })
    const propsB = input({
      current: { ...session, id: 'session-B', pendingAssetIds: [] },
      appendPendingAssetIdsDetached: appendB,
    })
    const { update } = render(propsA)

    const listener = subscribeHandoff.mock.calls[0]?.[1] as (
      ids: readonly string[],
    ) => void
    act(() => listener(['n1']))

    update(propsB)
    await act(async () => {
      await Promise.resolve()
    })
    expect(appendA).toHaveBeenCalledWith('session-A', ['n1'])
    expect(appendB).not.toHaveBeenCalled()
    expect(rowA.ids).toEqual(['n1'])
  })
})

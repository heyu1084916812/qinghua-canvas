import { describe, expect, it, vi } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import type { Row, TableName } from '../../platform/ports'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import { createAssetLibraryRepository } from './assetLibraryRepository'
import { createAssetLibraryStore } from './assetLibraryStore'
import { createAssetHistoryRepository } from './assetHistoryRepository'

function seedStorage(rows: Partial<Record<TableName, Row[]>>) {
  const storage = createMemoryStorage({ rows })
  return { storage, repo: createAssetLibraryRepository(storage) }
}

const saved = (over: Partial<LibraryAsset> = {}): LibraryAsset => ({
  hash: 'h1',
  mime: 'image/png',
  bytes: 12,
  width: 512,
  height: 512,
  savedAt: 10,
  projectId: 'p1',
  prompt: '猫咪',
  model: 'image-pro',
  quality: 'high',
  ratio: '1:1',
  channelId: 'ch1',
  ...over,
})

describe('素材库仓储', () => {
  it('只列 assetLibrary，普通 assets 没有被收藏就不出现', async () => {
    const { repo } = seedStorage({
      assets: [
        { id: 'not-saved', hash: 'not-saved', mime: 'image/png', bytes: 9 },
      ],
      assetLibrary: [
        {
          id: 'saved',
          hash: 'saved',
          mime: 'image/png',
          bytes: 5,
          savedAt: 20,
          prompt: '收藏图',
        },
      ],
    })
    const list = await repo.list()
    expect(list.map((item) => item.hash)).toEqual(['saved'])
    expect(list[0]!.prompt).toBe('收藏图')
  })

  it('save 只写收藏关系到 assetLibrary，不改 assets 字节行', async () => {
    const { storage, repo } = seedStorage({
      assets: [{ id: 'h1', hash: 'h1', mime: 'image/png', bytes: new Uint8Array(4) }],
    })
    await repo.save(saved())
    expect(await storage.query('assetLibrary', {})).toHaveLength(1)
    expect((await storage.query('assets', { id: 'h1' }))[0]).toMatchObject({
      bytes: expect.any(Uint8Array),
    })
  })

  it('同 hash 再次保存是覆盖，不新增第二条收藏', async () => {
    const { repo } = seedStorage({})
    await repo.save(saved({ prompt: '第一版', savedAt: 1 }))
    await repo.save(saved({ prompt: '第二版', savedAt: 2 }))
    const list = await repo.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.prompt).toBe('第二版')
  })

  it('remove 只删收藏关系，assets 与节点原样保留', async () => {
    const { storage, repo } = seedStorage({
      assets: [{ id: 'a1', hash: 'a1', mime: 'image/png', bytes: new Uint8Array(4) }],
      assetLibrary: [{ id: 'a1', hash: 'a1', mime: 'image/png', bytes: 4, savedAt: 1 }],
      nodes: [{ id: 'n1', projectId: 'p1', data: { assetHash: 'a1' } }],
    })
    await repo.remove('a1')
    expect(await storage.query('assetLibrary', {})).toHaveLength(0)
    expect(await storage.query('assets', {})).toHaveLength(1)
    expect(await storage.query('nodes', {})).toHaveLength(1)
  })

  it('removeMany 隐藏素材记录、删收藏关系与对应生成历史，assets 与节点保留', async () => {
    const { storage, repo } = seedStorage({
      assets: [{ id: 'a1', hash: 'a1', mime: 'image/png', bytes: new Uint8Array(4) }],
      assetLibrary: [{ id: 'a1', hash: 'a1', mime: 'image/png', bytes: 4, savedAt: 1 }],
      runRecords: [{ id: 'r1', projectId: 'p1', outputHashes: ['a1'] }],
      nodes: [{ id: 'n1', projectId: 'p1', data: { assetHash: 'a1' } }],
    })
    expect(await repo.removeMany(['a1'])).toBe(1)
    expect(await repo.list()).toHaveLength(0)
    expect([...(await repo.listHidden())]).toEqual(['a1'])
    expect(await storage.query('assets', {})).toHaveLength(1)
    expect(await storage.query('runRecords', {})).toHaveLength(0)
    expect(await storage.query('nodes', {})).toHaveLength(1)
  })

  it('隐藏后再次保存会恢复素材页记录', async () => {
    const { repo } = seedStorage({})
    await repo.save(saved({ hash: 'a1' }))
    await repo.removeMany(['a1'])
    expect(await repo.list()).toHaveLength(0)
    await repo.save(saved({ hash: 'a1', prompt: '重新收藏' }))
    expect((await repo.list()).map((item) => item.hash)).toEqual(['a1'])
    expect((await repo.listHidden()).has('a1')).toBe(false)
  })
})

describe('素材库 store', () => {
  const setup = async () => {
    const { storage, repo } = seedStorage({
      assetLibrary: [
        {
          id: 'i1',
          hash: 'i1',
          mime: 'image/png',
          bytes: 2048,
          width: 512,
          height: 512,
          savedAt: 10,
          prompt: '猫咪',
          model: 'image-pro',
        },
        {
          id: 'v1',
          hash: 'v1',
          mime: 'video/mp4',
          bytes: 4096,
          savedAt: 20,
          prompt: '狗狗奔跑',
        },
      ],
    })
    const store = createAssetLibraryStore(repo)
    await store.load()
    return { store, repo, storage }
  }

  it('load 后按保存时间倒序，loaded 为真', async () => {
    const { store } = await setup()
    expect(store.getState().visible.map((item) => item.hash)).toEqual(['v1', 'i1'])
    expect(store.getState().loaded).toBe(true)
  })

  it('类型与关键字筛选叠加是「与」关系', async () => {
    const { store } = await setup()
    store.setFilter('image')
    store.setQuery('猫咪')
    expect(store.getState().visible.map((item) => item.hash)).toEqual(['i1'])
    store.setFilter('video')
    expect(store.getState().visible).toHaveLength(0)
  })

  it('save 同 hash 覆盖、重新排序，并同步 visible', async () => {
    const { store, repo } = await setup()
    await store.save(saved({ hash: 'i1', savedAt: 30, prompt: '新提示词' }))
    expect(store.getState().visible.map((item) => item.hash)).toEqual(['i1', 'v1'])
    expect(store.getState().visible[0]!.prompt).toBe('新提示词')
    expect(await repo.list()).toHaveLength(2)
  })

  it('取消收藏后卡片消失，但资产字节与其它表保留', async () => {
    const { store, storage } = await setup()
    await storage.put('assets', { id: 'v1', hash: 'v1', mime: 'video/mp4', bytes: 4096 })
    await store.remove('v1')
    expect(store.getState().visible.map((item) => item.hash)).toEqual(['i1'])
    expect(await storage.query('assetLibrary', { id: 'v1' })).toHaveLength(0)
    expect(await storage.query('assets', { id: 'v1' })).toHaveLength(1)
  })

  it('删除失败时按库恢复', async () => {
    const { repo } = await setup()
    const failing = {
      ...repo,
      remove: async () => {
        throw new Error('存储挂了')
      },
    }
    const store = createAssetLibraryStore(failing)
    await store.load()
    await expect(store.remove('v1')).rejects.toThrow('删除素材失败')
    expect(store.getState().visible.map((item) => item.hash)).toEqual(['v1', 'i1'])
  })

  it('批量移除后素材库与全部历史同时消失，底层字节仍在', async () => {
    const { storage, repo } = seedStorage({
      assets: [
        { id: 'i1', hash: 'i1', mime: 'image/png', bytes: 4 },
        { id: 'v1', hash: 'v1', mime: 'video/mp4', bytes: 8 },
      ],
      assetLibrary: [
        { id: 'i1', hash: 'i1', mime: 'image/png', bytes: 4, savedAt: 10 },
        { id: 'v1', hash: 'v1', mime: 'video/mp4', bytes: 8, savedAt: 20 },
      ],
      runRecords: [
        {
          id: 'r1',
          nodeId: 'n1',
          projectId: 'p1',
          version: 1,
          createdAt: 10,
          status: 'succeeded',
          inputs: [],
          params: { prompt: '图片' },
          outputHashes: ['i1'],
        },
        {
          id: 'r2',
          nodeId: 'n2',
          projectId: 'p1',
          version: 1,
          createdAt: 20,
          status: 'succeeded',
          inputs: [],
          params: { prompt: '视频' },
          outputHashes: ['v1'],
        },
      ],
    })
    const store = createAssetLibraryStore(repo, createAssetHistoryRepository(storage))
    await store.load()
    expect(await store.removeMany(['i1', 'v1'])).toBe(2)
    expect(store.getState().visible).toHaveLength(0)
    expect(store.getState().historyVisible).toHaveLength(0)
    expect(await storage.query('assets', {})).toHaveLength(2)
    expect(await storage.query('runRecords', {})).toHaveLength(0)
  })

  it('生成历史首屏只查 30 条，加载更多再取下一页', async () => {
    const runRecords = Array.from({ length: 300 }, (_, index) => ({
      id: `run-${index}`,
      projectId: 'p1',
      createdAt: 10_000 - index,
      status: 'succeeded',
      inputs: [],
      params: { prompt: `历史 ${index}` },
      outputHashes: [`history-${index}`],
    }))
    const { storage, repo } = seedStorage({ runRecords })
    const queryPage = vi.spyOn(storage, 'queryPage')
    const store = createAssetLibraryStore(
      repo,
      createAssetHistoryRepository(storage),
    )

    await Promise.all([store.load(), store.load()])

    expect(store.getState().history).toHaveLength(30)
    expect(store.getState().historyHasMore).toBe(true)
    expect(store.getState().historyNextOffset).toBe(30)
    expect(store.getState().historyTotalRuns).toBe(300)
    expect(queryPage).toHaveBeenCalledWith(
      'runRecords',
      {},
      expect.objectContaining({ offset: 0, limit: 30 }),
    )
    expect(
      queryPage.mock.calls.filter(([table]) => table === 'runRecords'),
    ).toHaveLength(1)

    await store.loadMoreHistory()

    expect(store.getState().history).toHaveLength(60)
    expect(store.getState().historyHasMore).toBe(true)
    expect(store.getState().historyNextOffset).toBe(60)
    expect(store.getState().historyLoadingMore).toBe(false)
  })

  it('分页追加载到旧记录时，同一 hash 仍保留最新一次生成元数据', async () => {
    const runRecords = [
      {
        id: 'run-new',
        projectId: 'p1',
        createdAt: 1_000,
        status: 'succeeded',
        inputs: [],
        params: { prompt: '新版本' },
        outputHashes: ['shared-history'],
      },
      ...Array.from({ length: 29 }, (_, index) => ({
        id: `run-${index}`,
        projectId: 'p1',
        createdAt: 999 - index,
        status: 'succeeded',
        inputs: [],
        params: { prompt: `历史 ${index}` },
        outputHashes: [`history-${index}`],
      })),
      {
        id: 'run-old',
        projectId: 'p1',
        createdAt: 500,
        status: 'succeeded',
        inputs: [],
        params: { prompt: '旧版本' },
        outputHashes: ['shared-history'],
      },
    ]
    const { storage, repo } = seedStorage({ runRecords })
    const store = createAssetLibraryStore(
      repo,
      createAssetHistoryRepository(storage),
    )

    await store.load()
    await store.loadMoreHistory()

    const shared = store
      .getState()
      .history.find(
        (item) => item.kind === 'output' && item.hash === 'shared-history',
      )
    expect(shared?.kind === 'output' ? shared.prompt : undefined).toBe('新版本')
    expect(store.getState().history).toHaveLength(30)
  })
})

/**
 * 素材标签（对账 #303）。
 *
 * 三条口径在这一层落地：**标签独立于收藏关系**（没收藏也能打）、
 * **不动 `savedAt`**（打个标签不该让这张图跳到列表最前面）、
 * **两张列表同步**（历史卡片与素材库卡片显示的是同一份标签）。
 */
describe('素材标签', () => {
  it('★★★ 仓储：标签写独立映射；已收藏 / 未收藏都能打；删光就从映射去掉', async () => {
    const { storage, repo } = seedStorage({
      assets: [{ id: 'not-saved', hash: 'not-saved', mime: 'image/png', bytes: 3 }],
      assetLibrary: [{ id: 'i1', hash: 'i1', mime: 'image/png', bytes: 5, savedAt: 10 }],
    })
    await repo.setTags('i1', ['客户A', '客户A', '  春季款  '])
    expect((await repo.listTagMap()).get('i1')).toEqual(['客户A', '春季款'])

    await repo.setTags('not-saved', ['客户A'])
    expect(await storage.query('assetLibrary', { id: 'not-saved' })).toHaveLength(0)
    expect((await repo.listTagMap()).get('not-saved')).toEqual(['客户A'])

    await repo.setTags('i1', [])
    expect((await repo.listTagMap()).has('i1')).toBe(false)
  })

  it('★★★ store：写标签后**两张列表同步**；把正在筛的那个删空 ⇒ 自动取消筛选', async () => {
    const { storage, repo } = seedStorage({
      assets: [{ id: 'i1', hash: 'i1', mime: 'image/png', bytes: 5 }],
      assetLibrary: [{ id: 'i1', hash: 'i1', mime: 'image/png', bytes: 5, savedAt: 10 }],
      runRecords: [
        {
          id: 'r1',
          nodeId: 'n1',
          projectId: 'p1',
          version: 1,
          createdAt: 5,
          status: 'succeeded',
          inputs: [],
          params: { prompt: '猫咪' },
          outputHashes: ['i1'],
        },
      ],
    })
    const store = createAssetLibraryStore(repo, createAssetHistoryRepository(storage))
    await store.load()
    expect(store.getState().tags).toEqual([])

    await store.setTags('i1', ['客户A'])
    expect(store.getState().tags).toEqual([{ tag: '客户A', count: 1 }])
    expect(store.getState().visible[0]!.tags).toEqual(['客户A'])
    const historyItem = store.getState().history[0]!
    expect(historyItem.kind === 'output' ? historyItem.tags : undefined).toEqual(['客户A'])

    /* 点这一档：两张列表都该只剩它 */
    store.setTag('客户A')
    expect(store.getState().visible.map((a) => a.hash)).toEqual(['i1'])
    expect(store.getState().historyVisible).toHaveLength(1)

    /* 把这一档删空：筛选**自动取消**（否则列表永远空着、左侧又找不到那一档可以点掉） */
    await store.setTags('i1', [])
    expect(store.getState().tag).toBeNull()
    expect(store.getState().tags).toEqual([])
    expect(store.getState().visible.map((a) => a.hash)).toEqual(['i1'])
  })

  it('★★ 未收藏的生成历史也能打标签，并按标签参与筛选', async () => {
    const { storage, repo } = seedStorage({
      assets: [{ id: 'h1', hash: 'h1', mime: 'image/png', bytes: 5 }],
      runRecords: [
        {
          id: 'r2',
          nodeId: 'n2',
          projectId: 'p1',
          version: 1,
          createdAt: 6,
          status: 'succeeded',
          inputs: [],
          params: { prompt: '未收藏' },
          outputHashes: ['h1'],
        },
      ],
    })
    const store = createAssetLibraryStore(repo, createAssetHistoryRepository(storage))
    await store.load()
    expect(store.getState().assets).toHaveLength(0)

    await store.setTags('h1', ['客户B'])
    expect(store.getState().tags).toEqual([{ tag: '客户B', count: 1 }])
    store.setTag('客户B')
    expect(store.getState().historyVisible.map((item) => item.kind === 'output' && item.hash)).toEqual([
      'h1',
    ])
  })

  it('★★★ 只在收藏里的标签：在生成历史页点它 ⇒ 自动切到收藏内容（否则一片空白）', async () => {
    /* 联网调研保存的参考图就是这样：只有收藏关系，没有任何生成记录 */
    const { storage, repo } = seedStorage({
      assets: [{ id: 'i1', hash: 'i1', mime: 'image/png', bytes: 5 }],
      assetLibrary: [{ id: 'i1', hash: 'i1', mime: 'image/png', bytes: 5, savedAt: 20 }],
    })
    const store = createAssetLibraryStore(repo, createAssetHistoryRepository(storage))
    await store.load()
    await store.setTags('i1', ['设计调研'])
    expect(store.getState().quick).toBe('all')

    store.setTag('设计调研')
    const state = store.getState()
    expect(state.quick).toBe('saved')
    expect(state.visible.map((asset) => asset.hash)).toEqual(['i1'])
    expect(state.historyVisible).toHaveLength(0)
  })

  it('★★★ 只在历史里的标签：在收藏内容页点它 ⇒ 切回全部历史', async () => {
    const { storage, repo } = seedStorage({
      assets: [{ id: 'h1', hash: 'h1', mime: 'image/png', bytes: 5 }],
      runRecords: [
        {
          id: 'r3',
          nodeId: 'n3',
          projectId: 'p1',
          version: 1,
          createdAt: 7,
          status: 'succeeded',
          inputs: [],
          params: { prompt: '未收藏' },
          outputHashes: ['h1'],
        },
      ],
    })
    const store = createAssetLibraryStore(repo, createAssetHistoryRepository(storage))
    await store.load()
    await store.setTags('h1', ['客户B'])
    store.setQuick('saved')
    expect(store.getState().visible).toHaveLength(0)

    store.setTag('客户B')
    const state = store.getState()
    expect(state.quick).toBe('all')
    expect(state.historyVisible.map((item) => item.kind === 'output' && item.hash)).toEqual(['h1'])
  })

  it('★★ 两页都有这条标签时**不替你切页签**（对账 #303 的原意）', async () => {
    const { storage, repo } = seedStorage({
      assets: [{ id: 'i1', hash: 'i1', mime: 'image/png', bytes: 5 }],
      assetLibrary: [{ id: 'i1', hash: 'i1', mime: 'image/png', bytes: 5, savedAt: 20 }],
      runRecords: [
        {
          id: 'r4',
          nodeId: 'n4',
          projectId: 'p1',
          version: 1,
          createdAt: 8,
          status: 'succeeded',
          inputs: [],
          params: { prompt: '已收藏' },
          outputHashes: ['i1'],
        },
      ],
    })
    const store = createAssetLibraryStore(repo, createAssetHistoryRepository(storage))
    await store.load()
    await store.setTags('i1', ['客户A'])

    store.setTag('客户A')
    expect(store.getState().quick).toBe('all')
    expect(store.getState().historyVisible).toHaveLength(1)

    store.setQuick('saved')
    store.setTag('客户A')
    expect(store.getState().quick).toBe('saved')
    expect(store.getState().visible.map((asset) => asset.hash)).toEqual(['i1'])
  })
})

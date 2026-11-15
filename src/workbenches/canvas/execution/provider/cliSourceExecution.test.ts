/**
 * 「本机 CLI」来源端到端（对账 #1133 逻辑 4）：节点模型 `cli:jimeng` → 计划 → 预检（合成 CLI 渠道）
 * → **真实** `createChannelAdapter`（桌面分支 = `cliRun.ts`，CliPort 用假实现）→ 执行引擎 → 产物回填节点。
 * 只把「起子进程」那一层换成假的；选路、适配器工厂、落位全走生产代码。
 */
import { createElement, type ReactNode } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformProvider } from '../../../../app/providers/PlatformProvider'
import { ChannelStoreContext } from '../../../../app/providers/ChannelStoreProvider'
import { SkillStoreContext } from '../../../../app/providers/SkillStoreProvider'
import { PresetTextContext } from '../../../../app/providers/PresetTextProvider'
import type { Channel } from '../../../../domain/project/channel'
import { BUILTIN_CATALOG } from '../../../../domain/project/protocol'
import { registerAllSpecs } from '../../../../domain/canvas/nodeSpecs'
import { createChannelAdapter } from '../../../../platform/channels/registry'
import { resolvedChannelConfig } from '../../../../platform/generation/channelAdapterConfig'
import { createMemoryPlatform } from '../../../../platform/memory'
import type { CliPort, PlatformKit } from '../../../../platform/ports'
import type { ChannelStore } from '../../../../state/channel/channelStore'
import { createCanvasStore, type CanvasStore } from '../../../../state/workbenches/canvas/store'
import { CanvasStoreProvider } from '../../storeContext'
import { CanvasExecutionProvider, useCanvasExecution, type CanvasExecutionApi } from '../CanvasExecutionProvider'
import {
  activateCanvasExecutionRuntime,
  disposeAllCanvasExecutionRuntimes,
  resetCanvasExecutionRuntimesForTests,
} from '../canvasExecutionRuntime'
import { canvasRunStatesOf, resetCanvasRunStatesForTests } from '../canvasRunState'

const generationMocks = vi.hoisted(() => ({ resolve: vi.fn(), completeText: vi.fn() }))
vi.mock('../../../../platform/generation', () => ({ createGenerationClient: () => generationMocks }))
registerAllSpecs()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 1×1 PNG（魔数 + IHDR），让 `sniffMimeFromBytes` / 尺寸解析认得出 */
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (ch) => ch.charCodeAt(0),
)

const roots = new Set<TestRenderer.ReactTestRenderer>()
const stores = new Set<CanvasStore>()

beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), innerWidth: 1440, innerHeight: 900 })
  generationMocks.resolve.mockReset()
})
afterEach(async () => {
  for (const root of roots) act(() => root.unmount())
  roots.clear()
  for (const store of stores) store.dispose()
  stores.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetCanvasRunStatesForTests()
  await disposeAllCanvasExecutionRuntimes()
  resetCanvasExecutionRuntimesForTests()
})

function fakeCli(found: boolean): CliPort & { runs: { program: string; args: string[] }[] } {
  const runs: { program: string; args: string[] }[] = []
  return {
    runs,
    which: vi.fn(async (program: string) => (found ? `/usr/bin/${program}` : null)),
    run: vi.fn(async (req: { program: string; args: string[] }) => {
      runs.push({ program: req.program, args: req.args })
      return { code: 0, stdout: 'ok', stderr: '', ms: 12, timedOut: false, cancelled: false }
    }),
    kill: vi.fn(async () => true),
    spawnWindow: vi.fn(),
    outDir: vi.fn(async () => '/data/cli-out'),
    readOut: vi.fn(async () => PNG),
    importAsset: vi.fn(async () => '/data/cli-in/a.png'),
  } as unknown as CliPort & { runs: { program: string; args: string[] }[] }
}

const channels = {
  getState: () => ({ channels: [] as Channel[], routeStrategy: 'priority' }),
  protocolCatalog: () => BUILTIN_CATALOG,
  planGenerationRoute: vi.fn(),
} as unknown as ChannelStore

async function mount(platform: PlatformKit, store: CanvasStore): Promise<() => CanvasExecutionApi> {
  let api!: CanvasExecutionApi
  function Probe() {
    api = useCanvasExecution()
    return null
  }
  const skills = { skills: [], builtinSkills: [], userSkills: [], loading: false, reload: vi.fn(), create: vi.fn(), save: vi.fn(), remove: vi.fn(), copyBuiltin: vi.fn(), restoreBuiltin: vi.fn() }
  const tree: ReactNode = createElement(
    PlatformProvider,
    { create: () => platform },
    createElement(ChannelStoreContext.Provider, { value: channels },
      createElement(SkillStoreContext.Provider, { value: skills as never },
        createElement(PresetTextContext.Provider, { value: { overrides: {}, loading: false, reload: vi.fn(), save: vi.fn() } },
          createElement(CanvasStoreProvider, { store, children: createElement(CanvasExecutionProvider, null, createElement(Probe)) })))),
  )
  let root!: TestRenderer.ReactTestRenderer
  await act(async () => {
    root = TestRenderer.create(tree)
    await Promise.resolve()
  })
  roots.add(root)
  return () => api
}

function setup(cli: CliPort | undefined) {
  const platform: PlatformKit = { ...createMemoryPlatform(), ...(cli ? { cli } : {}) }
  const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })
  stores.add(store)
  activateCanvasExecutionRuntime('p1')
  /** 真实适配器工厂：选路给了哪条（合成的 CLI）渠道，就造哪条的适配器 */
  generationMocks.resolve.mockImplementation(async ({ channel }: { channel: Channel }) => ({
    adapter: createChannelAdapter(resolvedChannelConfig(channel, BUILTIN_CATALOG, null), platform),
  }))
  const nodeId = (store.dispatch({
    kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 0, y: 0 },
    data: { mode: 'image', prompt: '一只橘猫', source: 'cli', channelId: 'cli:jimeng', model: 'cli:jimeng', thumbOrder: [], upstreamHidden: [], linkedPromptNodeIds: [] },
  }).patches[0] as unknown as { row: { id: string } }).row.id
  return { platform, store, nodeId }
}

describe('本机 CLI 来源端到端（#1133）', () => {
  it('cli:jimeng → 合成渠道 → 真起 jimeng 命令 → 产物回填到节点', async () => {
    const cli = fakeCli(true)
    const { store, platform, nodeId } = setup(cli)
    const api = (await mount(platform, store))()
    await act(async () => {
      await api.runNode(nodeId)
    })
    expect(generationMocks.resolve).toHaveBeenCalledWith(expect.objectContaining({
      channel: expect.objectContaining({ id: 'cli:jimeng', protocol: 'jimeng-cli' }),
      request: { model: 'jimeng-image' },
    }))
    expect(cli.runs).toHaveLength(1)
    expect(cli.runs[0]!.program).toBe('jimeng')
    expect(cli.runs[0]!.args).toEqual(expect.arrayContaining(['generate', '--prompt', '一只橘猫', '--out']))
    const node = store.getSnapshot().nodes.find((item) => item.id === nodeId)
    expect((node?.data as { assetHash?: string }).assetHash).toMatch(/\S/)
    expect(canvasRunStatesOf('p1').get(nodeId)).toBeUndefined()
  })

  it('本机没检测到命令：预检拦下，不起进程、节点留可读原因', async () => {
    const cli = fakeCli(false)
    const { store, platform, nodeId } = setup(cli)
    const api = (await mount(platform, store))()
    await act(async () => {
      await api.runNode(nodeId).catch(() => undefined)
    })
    expect(cli.run).not.toHaveBeenCalled()
    expect(generationMocks.resolve).not.toHaveBeenCalled()
    const state = canvasRunStatesOf('p1').get(nodeId)
    expect(state?.kind).toBe('failed')
    expect(JSON.stringify(state)).toContain('本机未检测到「即梦」的命令「jimeng」')
  })

  it('网页版（没有 CliPort）：拦下并说明需要桌面版', async () => {
    const { store, platform, nodeId } = setup(undefined)
    const api = (await mount(platform, store))()
    await act(async () => {
      await api.runNode(nodeId).catch(() => undefined)
    })
    expect(generationMocks.resolve).not.toHaveBeenCalled()
    expect(JSON.stringify(canvasRunStatesOf('p1').get(nodeId))).toContain('桌面版')
  })
})

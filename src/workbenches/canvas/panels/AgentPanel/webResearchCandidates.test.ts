import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerAllSpecs } from '../../../../domain/canvas/nodeSpecs'
import type { NetworkPort } from '../../../../platform/ports'
import { createMemoryPlatform } from '../../../../platform/memory'
import { createCanvasStore } from '../../../../state/workbenches/canvas/store'
import { runDesignResearch } from '../../../../features/shared/research/designResearchRunner'
import { readWebPage } from '../../../../features/shared/research/webPageReader'
import { TAVILY_SEARCH_ENDPOINT } from '../../../../features/shared/research/tavilySearch'
import { BING_IMAGE_ENDPOINT, BING_WEB_ENDPOINT } from '../../../../features/shared/research/bingSearch'
import { executeReadTool, type AgentToolContext } from '../../agent/tools'
import { describeToolResult } from './conversation'
import { createAgentToolResearch } from './agentToolResearch'

const isBingResultPage = (url: string) =>
  url.startsWith(BING_WEB_ENDPOINT) || url.startsWith(BING_IMAGE_ENDPOINT)

/**
 * 护栏（用户 2026-11-11 拍板，对齐 Lovart）：联网搜到的图只是对话里的候选，
 * **不自动进参考台账、不喂生图**；只有用户点「加入项目参考」才入栏。
 */
const SOURCES = {
  ...import.meta.glob('../../../../features/shared/research/*.ts', { eager: true, query: '?raw', import: 'default' }),
  ...import.meta.glob('../../agent/tools.ts', { eager: true, query: '?raw', import: 'default' }),
  ...import.meta.glob('./*.ts', { eager: true, query: '?raw', import: 'default' }),
} as Record<string, string>
/** 以仓库路径取源码；glob 键是相对本文件的路径，这里统一换算。 */
const read = (path: string): string => {
  const key = path
    .replace('src/features/shared/research/', '../../../../features/shared/research/')
    .replace('src/workbenches/canvas/agent/', '../../agent/')
    .replace('src/workbenches/canvas/panels/AgentPanel/', './')
  const source = SOURCES[key]
  if (typeof source !== 'string') throw new Error(`source not found: ${path}`)
  return source
}

const RESEARCH_PIPELINE = [
  'src/features/shared/research/designResearchRunner.ts',
  'src/features/shared/research/tavilySearch.ts',
  'src/features/shared/research/webPageReader.ts',
  'src/features/shared/research/openResearchSearch.ts',
  'src/workbenches/canvas/panels/AgentPanel/agentToolResearch.ts',
  'src/workbenches/canvas/agent/tools.ts',
]

beforeEach(() => registerAllSpecs())

describe('联网搜索结果只是候选', () => {
  it('调研链路的模块不引用参考台账、素材保存或候选入栏', () => {
    for (const path of RESEARCH_PIPELINE) {
      const source = read(path)
      expect(source, path).not.toMatch(/referenceLedger/i)
      expect(source, path).not.toMatch(/saveResearchItem|saveDesignResearchItem/)
      expect(source, path).not.toMatch(/addResearchCandidateToProject/)
    }
  })

  it('候选入栏只有用户点击这一条入口', () => {
    const files = [
      'src/workbenches/canvas/panels/AgentPanel/agentTurnRequest.ts',
      'src/workbenches/canvas/panels/AgentPanel/agentTurnReferences.ts',
      'src/workbenches/canvas/panels/AgentPanel/agentLoopDeps.ts',
      'src/workbenches/canvas/panels/AgentPanel/useAgentPanelToolModel.ts',
      'src/workbenches/canvas/panels/AgentPanel/conversation.ts',
    ]
    for (const path of files) {
      expect(read(path), path).not.toMatch(/addResearchCandidateToProject/)
    }
    expect(read('src/workbenches/canvas/panels/AgentPanel/useAgentResearchReferenceController.ts'))
      .toMatch(/addResearchCandidateToProject/)
  })

  it('真实执行一次 researchDesign：画布不变，结果只作为对话候选图卡返回', async () => {
    const request = vi.fn<NetworkPort['request']>(async (req) => {
      // 免 Key 的 Bing 结果页离线 → 回退到已填 Key 的 Tavily。
      if (isBingResultPage(req.url)) throw new Error('offline')
      if (req.url !== TAVILY_SEARCH_ENDPOINT) throw new Error(`unexpected ${req.url}`)
      return {
        status: 200,
        headers: {},
        text: async () => '',
        json: async <T,>() => ({
          results: [{ title: 'Coffee poster trends', url: 'https://t.example.com/a', content: 'c', score: 1 }],
          images: [{ url: 'https://t.example.com/poster.jpg', description: 'retro coffee poster' }],
        }) as T,
        arrayBuffer: async () => new ArrayBuffer(0),
      }
    })
    const network: NetworkPort = { request, stream: async function* () {} }
    const research = createAgentToolResearch({
      remember: async () => ({ id: 'm', text: '' }),
      readCachedSources: async () => [],
      readConfiguredSources: async () => [],
      readWebSearch: async () => ({ endpoint: '' }),
      readTavilyKey: async () => 'k',
      webEnabled: () => true,
      readPage: readWebPage,
      network,
      runResearch: runDesignResearch,
      signal: () => new AbortController().signal,
      describeError: String,
    })
    const store = createCanvasStore({ platform: createMemoryPlatform() as never, projectId: 'p1' })
    const before = JSON.stringify(store.getSnapshot())
    const ctx = {
      store,
      researchDesign: research.researchDesign,
      readPage: research.readPage,
    } as unknown as AgentToolContext
    const result = await executeReadTool('researchDesign', { topic: '咖啡海报', queries: ['coffee poster'] }, ctx)
    expect(JSON.stringify(store.getSnapshot())).toBe(before)
    const summary = describeToolResult('researchDesign', JSON.stringify(result))
    expect(summary.researchItems?.map((item) => item.imageUrl)).toContain('https://t.example.com/poster.jpg')
    expect(summary.nodeIds).toEqual([])
    // 网络只碰了搜索（Bing 结果页 + Tavily 备用）：没有任何素材下载或保存请求。
    expect(
      request.mock.calls.every(([req]) => req.url === TAVILY_SEARCH_ENDPOINT || isBingResultPage(req.url)),
    ).toBe(true)
  })
})

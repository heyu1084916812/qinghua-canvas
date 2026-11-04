import { describe, expect, it } from 'vitest'
import type { InspirationCase } from '../../../../domain/inspiration/cases'
import type { MemoryCandidate } from '../../../../domain/shared/memoryOrganizer'
import type { NetworkPort } from '../../../../platform/ports'
import type {
  DesignResearchRunnerDeps,
  DesignResearchRunnerInput,
} from '../../../../features/shared/research/designResearchRunner'
import {
  createAgentToolResearch,
  type AgentToolCachedInspirationSource,
  type AgentToolConfiguredInspirationSource,
} from './agentToolResearch'

const candidate: MemoryCandidate = {
  kind: 'decision',
  text: '主色用 #123456',
  scope: 'project',
  confidence: 0.9,
  reason: '用户明确指定',
}

const designCase = (
  sourceId: string,
  id: string,
): InspirationCase => ({
  id: `${sourceId}:${id}`,
  sourceId,
  sourceName: sourceId,
  title: id,
  prompt: `prompt-${id}`,
  imageUrl: '',
  tags: [],
})

const cached = (
  sourceId: string,
  ids: readonly string[],
): AgentToolCachedInspirationSource => ({
  sourceId,
  cases: ids.map((id) => designCase(sourceId, id)),
})

const configured = (
  id: string,
  enabled: boolean,
): AgentToolConfiguredInspirationSource => ({ id, enabled })

const network = {} as NetworkPort

/** 测试只关心「调研执行器收到了什么」，报告形状无关。 */
type FakeReport = { ok: true; topic: string }

interface HarnessInit {
  remember?: (value: MemoryCandidate) => Promise<{ id: string; text: string }>
  cachedSources?: readonly AgentToolCachedInspirationSource[]
  cachedThrows?: unknown
  configuredSources?: readonly AgentToolConfiguredInspirationSource[]
  configuredThrows?: unknown
  signal?: AbortSignal
  describeError?: (error: unknown) => string
}

const harness = (init: HarnessInit = {}) => {
  const researchCalls: {
    input: DesignResearchRunnerInput
    deps: DesignResearchRunnerDeps
    signal: AbortSignal
  }[] = []
  const remembers: MemoryCandidate[] = []
  const state = {
    signal: init.signal ?? new AbortController().signal,
    signalCalls: 0,
  }

  const tool = createAgentToolResearch<FakeReport>({
    remember: async (value) => {
      remembers.push(value)
      if (init.remember) return init.remember(value)
      return { id: 'memory-1', text: value.text }
    },
    readCachedSources: async () => {
      if (init.cachedThrows !== undefined) throw init.cachedThrows
      return init.cachedSources ?? []
    },
    readConfiguredSources: async () => {
      if (init.configuredThrows !== undefined) throw init.configuredThrows
      return init.configuredSources ?? []
    },
    network,
    runResearch: async (input, deps, signal) => {
      researchCalls.push({ input, deps, signal })
      return { ok: true, topic: input.topic }
    },
    signal: () => {
      state.signalCalls += 1
      return state.signal
    },
    describeError:
      init.describeError ??
      ((error) => (error instanceof Error ? error.message : String(error))),
  })

  return { tool, researchCalls, remembers, state }
}

describe('rememberMemory', () => {
  it('成功时回 { ok: true, memoryId, text }', async () => {
    const { tool, remembers } = harness()

    const result = await tool.rememberMemory(candidate)

    expect(result).toEqual({
      ok: true,
      memoryId: 'memory-1',
      text: '主色用 #123456',
    })
    expect(remembers).toEqual([candidate])
  })

  it('落库失败时收成 { ok: false, reason }，不向上抛', async () => {
    const { tool } = harness({
      remember: async () => {
        throw new Error('记忆槽已满')
      },
    })

    await expect(tool.rememberMemory(candidate)).resolves.toEqual({
      ok: false,
      reason: '记忆槽已满',
    })
  })

  it('reason 用调用方给的错误文本端口，而不是本地拼字符串', async () => {
    const { tool } = harness({
      remember: async () => {
        throw { code: 42 }
      },
      describeError: (error) => `结构化：${JSON.stringify(error)}`,
    })

    await expect(tool.rememberMemory(candidate)).resolves.toEqual({
      ok: false,
      reason: '结构化：{"code":42}',
    })
  })
})

describe('researchDesign', () => {
  it('只取已启用来源的案例，并保持缓存顺序', async () => {
    const { tool, researchCalls } = harness({
      cachedSources: [
        cached('src-a', ['a1', 'a2']),
        cached('src-b', ['b1']),
        cached('src-c', ['c1']),
      ],
      configuredSources: [
        configured('src-a', true),
        configured('src-b', false),
        configured('src-c', true),
      ],
    })

    await tool.researchDesign({ topic: '海报排版' })

    expect(researchCalls[0].deps.libraryCases?.map((item) => item.id)).toEqual([
      'src-a:a1',
      'src-a:a2',
      'src-c:c1',
    ])
  })

  it('缓存读失败只当空库，调研照跑', async () => {
    const { tool, researchCalls } = harness({
      cachedThrows: new Error('缓存表坏了'),
      configuredSources: [configured('src-a', true)],
    })

    await tool.researchDesign({ topic: '海报排版' })

    expect(researchCalls).toHaveLength(1)
    expect(researchCalls[0].deps.libraryCases).toEqual([])
  })

  it('设置读失败只当空库，调研照跑', async () => {
    const { tool, researchCalls } = harness({
      cachedSources: [cached('src-a', ['a1'])],
      configuredThrows: new Error('设置读不出来'),
    })

    await tool.researchDesign({ topic: '海报排版' })

    expect(researchCalls).toHaveLength(1)
    expect(researchCalls[0].deps.libraryCases).toEqual([])
  })

  it('两个来源都读失败也不整体失败', async () => {
    const { tool, researchCalls } = harness({
      cachedThrows: new Error('缓存表坏了'),
      configuredThrows: new Error('设置读不出来'),
    })

    await expect(
      tool.researchDesign({ topic: '海报排版' }),
    ).resolves.toMatchObject({ ok: true })
    expect(researchCalls).toHaveLength(1)
    expect(researchCalls[0].deps.libraryCases).toEqual([])
  })

  it('两个来源是同时发起的，不是串行等待', async () => {
    const started: string[] = []
    let resolveCached!: (
      value: readonly AgentToolCachedInspirationSource[],
    ) => void
    let resolveConfigured!: (
      value: readonly AgentToolConfiguredInspirationSource[],
    ) => void
    const cachedPromise = new Promise<
      readonly AgentToolCachedInspirationSource[]
    >((resolve) => {
      resolveCached = resolve
    })
    const configuredPromise = new Promise<
      readonly AgentToolConfiguredInspirationSource[]
    >((resolve) => {
      resolveConfigured = resolve
    })

    const tool = createAgentToolResearch<FakeReport>({
      remember: async (value) => ({ id: 'm', text: value.text }),
      readCachedSources: () => {
        started.push('cached')
        return cachedPromise
      },
      readConfiguredSources: () => {
        started.push('configured')
        return configuredPromise
      },
      network,
      runResearch: async (input) => ({ ok: true, topic: input.topic }),
      signal: () => new AbortController().signal,
      describeError: (error) => String(error),
    })

    const pending = tool.researchDesign({ topic: '并发' })
    // 两个读取必须在任何一个 resolve 之前都已发起。
    expect(started).toEqual(['cached', 'configured'])

    resolveCached([])
    resolveConfigured([])
    await pending
  })

  it('网络端口、输入和取消信号原样交给调研执行器', async () => {
    const signal = new AbortController().signal
    const { tool, researchCalls } = harness({ signal })

    await tool.researchDesign({
      topic: '杂志封面',
      urls: ['https://example.com/a'],
      maxResults: 5,
    })

    expect(researchCalls[0].input).toEqual({
      topic: '杂志封面',
      urls: ['https://example.com/a'],
      maxResults: 5,
    })
    expect(researchCalls[0].deps.network).toBe(network)
    expect(researchCalls[0].signal).toBe(signal)
  })

  it('每次调用都现取信号（不是创建时快照）', async () => {
    const first = new AbortController().signal
    const { tool, researchCalls, state } = harness({ signal: first })

    await tool.researchDesign({ topic: '第一次' })
    const second = new AbortController().signal
    state.signal = second
    await tool.researchDesign({ topic: '第二次' })

    expect(researchCalls[0].signal).toBe(first)
    expect(researchCalls[1].signal).toBe(second)
    expect(state.signalCalls).toBe(2)
  })
})

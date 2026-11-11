import type { InspirationCase } from '../../../../domain/inspiration/cases'
import type { MemoryCandidate } from '../../../../domain/shared/memoryOrganizer'
import type { NetworkPort } from '../../../../platform/ports'
import type {
  DesignResearchResult,
  DesignResearchRunnerDeps,
  DesignResearchRunnerInput,
} from '../../../../features/shared/research/designResearchRunner'
import type { WebSearchSettings } from '../../../../domain/inspiration/designResearch'
import type { ReadWebPageResult } from '../../../../features/shared/research/webPageReader'

/** 联网开关关闭时，两个联网工具统一返回的结果（模型据此如实告诉用户）。 */
export const WEB_RESEARCH_OFF_RESULT = {
  ok: false,
  webDisabled: true,
  error: '联网已关闭：用户在 Agent 输入框关掉了「联网」。不要搜索或读取网页；如需联网，请用户先打开开关。',
} as const

/** 灵感库缓存里本模块只关心「哪个来源、有哪些案例」。 */
export interface AgentToolCachedInspirationSource {
  sourceId: string
  cases: readonly InspirationCase[]
}

/** 设置里存着的灵感源，本模块只关心 id 与开关。 */
export interface AgentToolConfiguredInspirationSource {
  id: string
  enabled: boolean
}

export interface AgentToolResearchPorts<
  TReport = DesignResearchResult,
> {
  /** `memory.remember`：真落库；失败必须抛，由这里转成 `{ ok: false, reason }`。 */
  remember: (
    candidate: MemoryCandidate,
  ) => Promise<{ id: string; text: string }>
  /** `inspirationRepository.readAll`：读本地缓存的灵感库。 */
  readCachedSources: () => Promise<
    readonly AgentToolCachedInspirationSource[]
  >
  /** `loadInspirationSources`：读设置里的灵感源清单。 */
  readConfiguredSources: () => Promise<
    readonly AgentToolConfiguredInspirationSource[]
  >
  readWebSearch: () => Promise<WebSearchSettings>
  /** 读用户在设置里填的 Tavily Key；没有返回 null。Key 只往下传给请求头。 */
  readTavilyKey: () => Promise<string | null>
  /** Agent 输入框「联网」开关的当前值（调用时现取）。 */
  webEnabled: () => boolean
  /** `readWebPage` 本身（Jina Reader）。 */
  readPage: (
    network: NetworkPort,
    url: string,
    signal: AbortSignal,
  ) => Promise<ReadWebPageResult>
  /** 网络端口，原样交给调研执行器。 */
  network: NetworkPort
  /** `runDesignResearch` 本身。 */
  runResearch: (
    input: DesignResearchRunnerInput,
    deps: DesignResearchRunnerDeps,
    signal: AbortSignal,
  ) => Promise<TReport>
  /** 当前回合的取消信号；没有就由调用方造一个永不取消的。 */
  signal: () => AbortSignal
  /**
   * 错误文本（沿用 `errText`）。
   *
   * 走端口而不是本地 import：记忆写入失败的 reason 会原样进工具结果给人看，
   * 换个 `String(error)` 就会把结构化渠道错误变成 `[object Object]`。
   */
  describeError: (error: unknown) => string
}

export interface AgentToolResearch<
  TReport = DesignResearchResult,
> {
  rememberMemory: (candidate: MemoryCandidate) => Promise<{
    ok: boolean
    memoryId?: string
    text?: string
    reason?: string
  }>
  researchDesign: (
    input: DesignResearchRunnerInput,
  ) => Promise<TReport | typeof WEB_RESEARCH_OFF_RESULT>
  readPage: (input: {
    url: string
  }) => Promise<ReadWebPageResult | typeof WEB_RESEARCH_OFF_RESULT>
}

/**
 * 记忆写入与设计调研的编排。
 *
 * 只有一条硬规则：**读灵感库失败不能把整次调研拖垮**。缓存和设置各读各的、
 * 各自 `.catch(() => [])`，读不到就当空库继续跑——调研本身仍然可用。
 * 记忆写入相反：失败要收成 `{ ok: false, reason }` 交回工具层，不能向上抛成回合失败。
 */
export function createAgentToolResearch<
  TReport = DesignResearchResult,
>(ports: AgentToolResearchPorts<TReport>): AgentToolResearch<TReport> {
  return {
    rememberMemory: async (candidate) => {
      try {
        const saved = await ports.remember(candidate)
        return {
          ok: true,
          memoryId: saved.id,
          text: saved.text,
        }
      } catch (error) {
        return {
          ok: false,
          reason: ports.describeError(error),
        }
      }
    },
    researchDesign: async (input) => {
      if (!ports.webEnabled()) return WEB_RESEARCH_OFF_RESULT
      const [cachedSources, configuredSources, webSearch, tavilyApiKey] = await Promise.all([
        ports.readCachedSources().catch(() => []),
        ports.readConfiguredSources().catch(() => []),
        ports.readWebSearch().catch(() => undefined),
        ports.readTavilyKey().catch(() => null),
      ])
      const enabledIds = new Set(
        configuredSources
          .filter((source) => source.enabled)
          .map((source) => source.id),
      )
      const libraryCases = cachedSources
        .filter((source) => enabledIds.has(source.sourceId))
        .flatMap((source) => source.cases)
      return ports.runResearch(
        input,
        {
          network: ports.network,
          libraryCases,
          ...(webSearch ? { webSearch } : {}),
          tavilyApiKey,
        },
        ports.signal(),
      )
    },
    readPage: async ({ url }) => {
      if (!ports.webEnabled()) return WEB_RESEARCH_OFF_RESULT
      return ports.readPage(ports.network, url, ports.signal())
    },
  }
}

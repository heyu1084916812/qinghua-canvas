import type { EcommerceIntentDraft } from '../../../domain/ecommerce/chatParse'
import {
  buildIntentSystem,
  buildIntentText,
  parseEcommerceIntent,
} from '../../../domain/ecommerce/chatParse'
import type { ShotPlanResult } from '../../../domain/ecommerce/chatShots'
import type { EcommerceGenerationStage } from '../../../domain/ecommerce/progress'
import {
  languageLabel,
  type EcommerceRequest,
} from '../../../domain/ecommerce/types'
import type { EcommercePlatform } from '../../../domain/ecommerce/platforms'
import {
  planTitleOf,
  recentPlanSessions,
  toPlanMessages,
  toPlanSession,
  type EcommercePlanSession,
  type PlanSessionRowLike,
} from '../../../domain/ecommerce/sessions'
import type { NodeInput } from '../../../domain/shared/execution/types'
import type { AgentSession } from '../../../state/agent/agentSessionTypes'
import { createId } from '../../../shared/id'
import { directTextTrace } from '../../../state/shared/directRun'
import {
  ecommerceVisualInputsOf,
  type LegacyGenerationNode,
} from '../ecommercePageSupport'
import {
  requestEcommerceIntent,
  requestEcommerceSellingPoints,
  requestEcommerceShots,
  type EcommerceChatTarget,
  type EcommerceTextRequestPorts,
} from './pageAiRequests'

type AssetInput = Extract<NodeInput, { kind: 'asset' }>

export interface PagePlanningSessionPort {
  list(projectId: string): Promise<readonly PlanSessionRowLike[]>
  create(input: {
    projectId: string
    channelId: string
    model: string
    title: string
  }): Promise<AgentSession>
  save(session: AgentSession, messages: AgentSession['messages']): Promise<void>
  remove(id: string): Promise<void>
}

export interface PagePlanningStatePort {
  setIntent(intent: EcommerceIntentDraft | null): void
  setIntentError(message: string): void
  setParsingIntent(parsing: boolean): void
  setPlanHistory(history: EcommercePlanSession[]): void
  setPreparingShots(preparing: boolean): void
  setTextRecordWarning(warning: string): void
  setGenerationStage(stage: EcommerceGenerationStage): void
}

export interface PagePlanningActionPorts {
  projectId: string
  platforms: readonly EcommercePlatform[]
  sessions: PagePlanningSessionPort
  assets: {
    read(nodeId: string): Promise<{ mime?: string } | null>
  }
  logger: {
    log(level: string, message: string, details?: unknown): void
  }
  completeWithTools: EcommerceTextRequestPorts['completeWithTools']
  onTextRecordWarning(warning: string): void
  trace?: typeof directTextTrace
  operationId?: () => string
  state: PagePlanningStatePort
}

export interface PagePlanningActionCoordinator {
  refreshPlanHistory(): Promise<void>
  savePlanSession(
    text: string,
    draft: EcommerceIntentDraft,
    chatTarget: EcommerceChatTarget | null,
  ): Promise<void>
  parseIntent(text: string, chatTarget: EcommerceChatTarget | null): Promise<void>
  writeSellingPoints(
    request: EcommerceRequest,
    chatTarget: EcommerceChatTarget | null,
  ): Promise<string>
  restorePlan(session: EcommercePlanSession): void
  removePlan(id: string): Promise<void>
  visualInputsFor(
    request: EcommerceRequest,
    nodes: readonly LegacyGenerationNode[],
  ): Promise<AssetInput[]>
  requestShots(
    request: EcommerceRequest,
    chatTarget: EcommerceChatTarget | null,
    nodes: readonly LegacyGenerationNode[],
  ): Promise<ShotPlanResult>
  planShots(
    request: EcommerceRequest,
    chatTarget: EcommerceChatTarget | null,
    nodes: readonly LegacyGenerationNode[],
  ): Promise<ShotPlanResult>
}

const timedSignal = (milliseconds: number) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), milliseconds)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

export function createPagePlanningActionCoordinator(
  ports: PagePlanningActionPorts,
): PagePlanningActionCoordinator {
  const trace = ports.trace ?? directTextTrace
  const nextOperationId = ports.operationId ?? (() => createId('op'))

  const refreshPlanHistory = async (): Promise<void> => {
    try {
      const rows = await ports.sessions.list(ports.projectId)
      const list = rows
        .map((row) => toPlanSession(row))
        .filter((item): item is EcommercePlanSession => item !== null)
      ports.state.setPlanHistory(recentPlanSessions(list))
    } catch (error) {
      ports.logger.log('warn', '[ecommerce] 方案历史读取失败', {
        error: String(error),
      })
    }
  }

  const savePlanSession = async (
    text: string,
    draft: EcommerceIntentDraft,
    chatTarget: EcommerceChatTarget | null,
  ): Promise<void> => {
    if (!chatTarget) return
    try {
      const created = await ports.sessions.create({
        projectId: ports.projectId,
        channelId: chatTarget.channelId,
        model: chatTarget.logicalModel,
        title: planTitleOf(text),
      })
      await ports.sessions.save(created, toPlanMessages(text, draft))
      await refreshPlanHistory()
    } catch (error) {
      ports.logger.log('warn', '[ecommerce] 方案历史写入失败', {
        error: String(error),
      })
    }
  }

  const parseIntent = async (
    text: string,
    chatTarget: EcommerceChatTarget | null,
  ): Promise<void> => {
    if (!chatTarget) {
      ports.state.setIntent(null)
      ports.state.setIntentError(
        '没有可用的对话模型 —— 先去「设置 → 模型服务」给一条服务勾上对话模型',
      )
      return
    }
    ports.state.setParsingIntent(true)
    ports.state.setIntentError('')
    ports.state.setTextRecordWarning('')
    ports.state.setIntent(null)
    const timeout = timedSignal(30_000)
    try {
      const parsed = await requestEcommerceIntent(
        {
          projectId: ports.projectId,
          chatTarget,
          operationId: nextOperationId(),
          completeWithTools: ports.completeWithTools,
          directTextTrace: trace,
          onRecordWarning: ports.onTextRecordWarning,
          abortSignal: () => timeout.signal,
          clearTimer: timeout.clear,
        },
        {
          text,
          platforms: ports.platforms,
          buildSystem: buildIntentSystem,
          buildUser: buildIntentText,
          parse: parseEcommerceIntent,
        },
      )
      if (parsed.ok) {
        ports.state.setIntent(parsed.draft)
        void savePlanSession(text, parsed.draft, chatTarget)
      } else {
        ports.state.setIntentError(parsed.error)
      }
    } catch {
      ports.state.setIntentError('解析失败：这次没能拿到结果，稍后再试。')
    } finally {
      timeout.clear()
      ports.state.setParsingIntent(false)
    }
  }

  const writeSellingPoints = async (
    request: EcommerceRequest,
    chatTarget: EcommerceChatTarget | null,
  ): Promise<string> => {
    if (!chatTarget) {
      throw new Error('没有可用的对话模型 —— 先在模型服务里勾选一个对话模型')
    }
    ports.state.setTextRecordWarning('')
    const timeout = timedSignal(30_000)
    const outcome = requestEcommerceSellingPoints(
      {
        projectId: ports.projectId,
        chatTarget,
        operationId: nextOperationId(),
        completeWithTools: ports.completeWithTools,
        directTextTrace: trace,
        onRecordWarning: ports.onTextRecordWarning,
        abortSignal: () => timeout.signal,
        clearTimer: timeout.clear,
      },
      {
        request,
        platformsWithName: ports.platforms,
        systemPrompt:
          '你是电商图片文案助手。只根据用户已经提供的事实，写 2–4 句简洁的商品卖点与画面要求。' +
          '不要编造参数、认证、功效、价格或品牌信息；只输出可直接放进输入框的正文，不要标题、解释或 JSON。',
        languageLabel,
      },
    )
    return outcome
  }

  const restorePlan = (session: EcommercePlanSession): void => {
    ports.state.setIntent(session.draft)
    ports.state.setIntentError('')
  }

  const removePlan = async (id: string): Promise<void> => {
    try {
      await ports.sessions.remove(id)
      await refreshPlanHistory()
    } catch (error) {
      ports.logger.log('warn', '[ecommerce] 方案历史删除失败', {
        error: String(error),
      })
    }
  }

  const visualInputsFor = async (
    request: EcommerceRequest,
    nodes: readonly LegacyGenerationNode[],
  ): Promise<AssetInput[]> => {
    const assets: Record<string, { mime?: string }> = {}
    for (const nodeId of new Set([
      request.productNodeId,
      ...(request.productNodeIds ?? []),
      ...request.referenceNodeIds,
    ].filter(Boolean))) {
      const payload = await ports.assets.read(nodeId)
      if (payload) assets[nodeId] = { mime: payload.mime }
    }
    return ecommerceVisualInputsOf(request, nodes, assets)
  }

  const requestShots = async (
    request: EcommerceRequest,
    chatTarget: EcommerceChatTarget | null,
    nodes: readonly LegacyGenerationNode[],
  ): Promise<ShotPlanResult> => {
    if (!chatTarget) {
      return {
        ok: false,
        error: '没有可用的对话模型 —— 先去「设置 → 模型服务」给一条服务勾上对话模型',
      }
    }
    ports.state.setTextRecordWarning('')
    const visualInputs = await visualInputsFor(request, nodes)
    if (visualInputs.length === 0) {
      return {
        ok: false,
        error: '没有可随对话发送的商品图 —— 无法先分析产品外观，已停止本次生图。',
      }
    }
    const operationId = nextOperationId()
    const timers = new Set<ReturnType<typeof setTimeout>>()
    return requestEcommerceShots(
      {
        projectId: ports.projectId,
        chatTarget,
        operationId,
        completeWithTools: ports.completeWithTools,
        directTextTrace: trace,
        onRecordWarning: ports.onTextRecordWarning,
        abortSignal: () => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 60_000)
          timers.add(timer)
          return controller.signal
        },
        clearTimer: () => {
          for (const timer of timers) clearTimeout(timer)
          timers.clear()
        },
        visualInputs,
        platforms: ports.platforms,
        setStage: ports.state.setGenerationStage,
      },
      request,
    )
  }

  const planShots = async (
    request: EcommerceRequest,
    chatTarget: EcommerceChatTarget | null,
    nodes: readonly LegacyGenerationNode[],
  ): Promise<ShotPlanResult> => {
    ports.state.setPreparingShots(true)
    try {
      return await requestShots(request, chatTarget, nodes)
    } finally {
      ports.state.setPreparingShots(false)
    }
  }

  return {
    refreshPlanHistory,
    savePlanSession,
    parseIntent,
    writeSellingPoints,
    restorePlan,
    removePlan,
    visualInputsFor,
    requestShots,
    planShots,
  }
}

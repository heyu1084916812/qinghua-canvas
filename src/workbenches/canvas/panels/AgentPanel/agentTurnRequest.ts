import type { GraphSnapshot } from '../../../../domain/canvas/model/graph'
import type { GenerationContextAsset } from '../../../../domain/canvas/model/node'
import type { Channel } from '../../../../domain/project/channel'
import type { GenerationAvailability } from '../../../../domain/project/generationRouting'
import type {
  ReferenceItem,
  ReferenceSelection,
  ReferenceUsage,
} from '../../../../domain/project/referenceLedger'
import type { Skill } from '../../../../domain/prompt/skill'
import type {
  MentionRef,
} from '../../text/MentionEditor'
import {
  parseMentions,
  stripMentionMarkup,
} from '../../text/MentionEditor'
import type {
  ToolDeclaration,
} from '../../../../domain/shared/execution/types'
import type { TextRunRequest } from '../../../../platform/channels/types'
import {
  formatContextBundleForPrompt,
} from '../../../../domain/shared/context'
import { memoryCandidateFromText } from '../../../../domain/shared/memoryOrganizer'
import {
  agentTaskPlanProgress,
  taskPlanPrompt,
} from '../../../../domain/agent/taskPlan'
import { capabilityOfLogical } from '../../../../domain/project/modelCatalog'
import { chatModelAcceptsImages } from '../../../../domain/shared/capability'
import { imageInputsOf } from '../../../../domain/shared/execution/inputs'
import { collectAgentLoopInputs } from './agentLoopInputs'
import type { AgentToolMode } from '../../../../features/shared/agent/toolSupport'
import {
  decideToolMode,
  ensureToolSupport,
} from '../../../../features/shared/agent/toolSupport'
import type { AgentMemoryPort } from '../../../../features/shared/agent/MemoryPort'
import type { RouteExecutionPort } from '../../../../features/shared/agent/RouteExecutionPort'
import { directTextTrace } from '../../../../state/shared/directRun'
import type {
  AgentSession,
  AgentSessionStore,
} from '../../../../state/agent/sessionStore'
import { createId } from '../../../../shared/id'
import {
  classifyAgentRequest,
  imageNodeIdsAmong,
  promptProfileForMode,
  resolveAgentSkillForTurn,
  summaryForAgentRequest,
  type AgentPromptProfile,
  type AgentRequestMode,
} from '../../agent/agentContextPolicy'
import {
  buildAgentSystemPromptWithContext,
  expectsPerImageFlows,
  looksLikePreserveRequest,
  looksLikeStyleOnlyRequest,
} from '../../agent/agentSystemPrompt'
import { sessionBriefForContinuation } from './agentSessionBrief'
import { agentToolsForRequestMode } from '../../agent/tools'
import { errText } from '../../agent/agentLoop'
import type {
  AgentChatRoute,
  ChatRoutePreparation,
} from './agentChatRoute'
import {
  persistAgentUserTurnBeforeRoute,
  type PersistedAgentUserTurn,
} from './agentTurnPersistence'
import {
  explicitMediaModelsFromMentions,
  type ExplicitMediaModels,
} from './mediaMentions'
import { projectAgentTurnReferences } from './agentTurnReferences'
import type {
  ReferenceLedgerRepository,
} from '../../../../state/project/referenceLedgerRepository'
import type { AgentPhaseEvent } from '../../../../domain/agent/phase'
import type { ReferenceCurationResult } from '../../../../domain/project/referenceCuration'

export interface AgentTurnContextTrace {
  digest: string
  memoryRefs: { id: string; revision: number }[]
  kitVersionRefs: { kitId: string; version: number }[]
  assetRefs: (GenerationContextAsset & { mime: string })[]
  brief?: string
  referenceEvidence?: string[]
  referenceWarnings?: string[]
  referencePhaseEvent?: AgentPhaseEvent
  skillPhaseEvent?: AgentPhaseEvent
}

export type AgentTurnMention = MentionRef & {
  kind: 'node' | 'model'
  prompt?: string
}

export interface PrepareAgentTurnRequestInput {
  session: AgentSession
  text: string
  internalControl?: boolean
  graph: GraphSnapshot
  selection: readonly string[]
  sessions: Pick<
    AgentSessionStore,
    'messagesFor' | 'saveMessages' | 'clearPendingAssetIds'
  >
  prepareRoute: () => Promise<ChatRoutePreparation>
  onPersisted: (turn: PersistedAgentUserTurn) => void
  onRouteReady: (operationId: string) => Promise<void>
  memory: Pick<AgentMemoryPort, 'read'>
  projectId: string
  readAssetMime: (hash: string) => Promise<string | null>
  notifyContextError: (message: string) => void
  /** 可选：项目参考台账。未接入时行为与旧版完全一致。 */
  referenceLedger?: {
    selectForTask: ReferenceLedgerRepository['selectForTask']
    listItems: ReferenceLedgerRepository['listItems']
  }
  /** 显式 reference chip 在上下文装配前的自动参考分析。 */
  autoCurateReferences?: (input: {
    sessionId: string
    operationId: string
    taskKey: string
    task: string
    route: AgentChatRoute
    itemIds: readonly string[]
    signal: AbortSignal
  }) => Promise<ReferenceCurationResult>
  skills: readonly Skill[]
  channels: readonly Channel[]
  canvasReviewEnabled: boolean
  activeAgentTools: readonly ToolDeclaration[]
  generationAvailability: {
    image?: GenerationAvailability
    video?: GenerationAvailability
  }
  routeExecution: RouteExecutionPort
  signal: AbortSignal
  notifyRecordWarning: (message: string) => void
}

export interface PreparedAgentTurnRequest {
  kind: 'ready'
  operationId: string
  persistedTurn: PersistedAgentUserTurn
  chatRoute: AgentChatRoute
  plainText: string
  mentions: AgentTurnMention[]
  visualNodeIds: string[]
  sentAssetIds: string[]
  contextPrompt: string
  contextTrace: AgentTurnContextTrace | null
  skill?: Skill
  explicitMediaModels: ExplicitMediaModels
  perImage: boolean
  requestMode: AgentRequestMode
  promptProfile: AgentPromptProfile
  toolMode: AgentToolMode
  turnTools: ToolDeclaration[]
  systemPrompt: string
  clearedPendingAssets?: AgentSession
}

export type AgentTurnRequestPreparation =
  | PreparedAgentTurnRequest
  | {
      kind: 'aborted_before_job'
      persistedTurn: PersistedAgentUserTurn
    }
  | {
      kind: 'route_failed'
      persistedTurn: PersistedAgentUserTurn
      message: string
    }
  | {
      kind: 'failed'
      persistedTurn: PersistedAgentUserTurn
      phase: 'context_conflict' | 'tool_probe'
      message: string
      contextTrace: AgentTurnContextTrace | null
    }

/**
 * Prepare one persisted Agent turn and everything the model loop needs.
 *
 * The user turn is saved before route preparation. `onRouteReady` is called only
 * after a route exists, so the caller can create the planning Job without ever
 * leaking one from a failed route. The returned refs are values, not mutations:
 * AgentPanel remains the owner of its per-session React refs.
 */
export async function prepareAgentTurnRequest(
  input: PrepareAgentTurnRequestInput,
): Promise<AgentTurnRequestPreparation> {
  const plainText = stripMentionMarkup(input.text)
  const rawMentions = parseMentions(input.text)
  const referenceIds = [...new Set([
    ...rawMentions
      .filter((mention) => mention.kind === 'reference')
      .map((mention) => mention.id),
    ...(input.session.referenceIds ?? []),
  ])]
  const sentAssetIds = [...new Set(input.session.pendingAssetIds ?? [])]
  const mentions = rawMentions
    .filter(
      (mention): mention is MentionRef & { kind: 'node' | 'model' } =>
        mention.kind === 'node' || mention.kind === 'model',
    )
    .map((mention): AgentTurnMention => {
      if (mention.kind !== 'node') return mention
      const node = input.graph.nodes.find((item) => item.id === mention.id)
      const data = (node?.data ?? {}) as {
        prompt?: unknown
        text?: unknown
      }
      const raw =
        typeof data.prompt === 'string' ? data.prompt : data.text
      const prompt =
        typeof raw === 'string' ? raw.trim().slice(0, 160) : ''
      return { ...mention, ...(prompt ? { prompt } : {}) }
    })
  const visualNodeIds = [
    ...new Set([
      ...sentAssetIds,
      ...mentions
        .filter(
          (mention): mention is AgentTurnMention & { kind: 'node' } =>
            mention.kind === 'node',
        )
        .map((mention) => mention.id),
    ]),
  ]

  const persistedRoute = await persistAgentUserTurnBeforeRoute(
    input.sessions,
    input.session.id,
    {
      content: plainText,
      display: input.text,
      imageNodeIds: visualNodeIds,
      ...(input.session.contextWindow
        ? { contextWindow: input.session.contextWindow }
        : {}),
      internalControl: input.internalControl === true,
    },
    input.prepareRoute,
    input.onPersisted,
  )
  const persistedTurn = persistedRoute.turn
  if (input.signal.aborted) {
    return { kind: 'aborted_before_job', persistedTurn }
  }
  if (!persistedRoute.route.ok) {
    return {
      kind: 'route_failed',
      persistedTurn,
      message: persistedRoute.route.message,
    }
  }

  const chatRoute = persistedRoute.route.route
  const operationId = createId('op')
  await input.onRouteReady(operationId)

  // 台账按任务类型登记用法；operationId 是每次随机生成，不能当 taskKey。
  const mentionedImageIds = imageNodeIdsAmong(
    input.graph.nodes,
    mentions
      .filter((mention) => mention.kind === 'node')
      .map((mention) => mention.id),
  )
  const selectedImageIds = imageNodeIdsAmong(
    input.graph.nodes,
    input.selection,
  )
  const activeTaskPlanForTask =
    input.session.taskPlan &&
    agentTaskPlanProgress(input.session.taskPlan).status === 'active'
      ? input.session.taskPlan
      : undefined
  const previousMessagesForTask = persistedTurn.historyMessages.slice(0, -1)
  const lastAssistantForTask = [...previousMessagesForTask].reverse().find(
    (message) => message.role === 'assistant',
  )
  const lastAssistantTextForTask = lastAssistantForTask?.content ?? ''
  const taskKey = classifyAgentRequest({
    text: plainText,
    hasMentionedImage: mentionedImageIds.length > 0,
    hasSelectedNodes: input.selection.length > 0,
    hasSelectedImage: selectedImageIds.length > 0,
    hasTaskPlan: Boolean(activeTaskPlanForTask),
    internalControl: input.internalControl === true,
    hasActiveContinuation: input.session.continuation !== undefined,
    hasPendingConfirmation: input.session.pendingConfirmation !== undefined,
    hasUnfinishedGeneration: /生成中\s*\d+\s*\/\s*\d+|等待生成|waiting_generation/.test(
      lastAssistantTextForTask,
    ),
    lastAssistantFailed: /HTTP\s*50\d|服务端返回错误|生成失败|运行失败|请求失败|上游/.test(
      lastAssistantTextForTask,
    ),
    hasNeedsAttentionJob: /needs_attention|需要人工处理|等待人工/.test(
      lastAssistantTextForTask,
    ),
  })
  const autoCurationWarnings: string[] = []
  if (referenceIds.length > 0 && input.autoCurateReferences) {
    try {
      const curation = await input.autoCurateReferences({
        sessionId: input.session.id,
        operationId,
        taskKey,
        task: plainText,
        route: chatRoute,
        itemIds: referenceIds,
        signal: input.signal,
      })
      autoCurationWarnings.push(
        ...curation.failed.map((item) =>
          `参考「${item.title}」自动分析失败：${item.reason}`,
        ),
        ...curation.limitations,
      )
      if (curation.failed.length > 0) {
        input.notifyContextError(
          `有 ${curation.failed.length} 条参考没有完成自动分析，已按显式 chip 继续。`,
        )
      }
    } catch (error) {
      const message = `参考自动分析未完成：${errText(error)}`
      autoCurationWarnings.push(message)
      input.notifyContextError(`${message}；已按显式 chip 继续。`)
    }
  }
  if (input.signal.aborted) {
    return { kind: 'aborted_before_job', persistedTurn }
  }

  let contextPrompt = ''
  let contextTrace: AgentTurnContextTrace | null = null
  try {
    const taskSelection = input.referenceLedger
      ? await input.referenceLedger.selectForTask(input.projectId, taskKey)
      : null
    const explicitItems = input.referenceLedger && referenceIds.length > 0
      ? (await input.referenceLedger.listItems(input.projectId)).filter(
          (item) => referenceIds.includes(item.id),
        )
      : []
    const selection = taskSelection
      ? mergeExplicitReferences(taskSelection, explicitItems, taskKey)
      : explicitItems.length > 0
        ? mergeExplicitReferences(
            { selected: [], omitted: [] },
            explicitItems,
            taskKey,
          )
        : null
    const bundle = await input.memory.read({
      projectId: input.projectId,
      workbench: 'canvas',
      request: plainText,
      sessionId: input.session.id,
    })
    const referenceMimes = selection
      ? await Promise.all(
          selection.selected.flatMap(({ item }) => {
            if (item.kind !== 'image' && item.kind !== 'video') return []
            const hashes = item.assets?.length
              ? item.assets.map((asset) => asset.hash)
              : item.assetHash
                ? [item.assetHash]
                : []
            return hashes.map(async (hash) => {
              const mime = await input.readAssetMime(hash).catch(() => null)
              return mime ? [hash, mime] as const : null
            })
          }),
        )
      : []
    const referenceMimeCache = new Map(
      referenceMimes.filter(
        (entry): entry is readonly [string, string] => entry !== null,
      ),
    )
    const projected = selection
      ? projectAgentTurnReferences(
          selection,
          (hash) => referenceMimeCache.get(hash) ?? null,
        )
      : null
    const referenceWarnings = [
      ...autoCurationWarnings,
      ...(projected?.warnings ?? []),
    ]
    const referencePhaseEvent: AgentPhaseEvent | undefined =
      projected?.phaseEvent
        ? autoCurationWarnings.length > 0
          ? {
              ...projected.phaseEvent,
              detail: [
                projected.phaseEvent.detail ?? '',
                ...autoCurationWarnings,
              ].filter(Boolean).join('\n'),
            }
          : projected.phaseEvent
        : autoCurationWarnings.length > 0
          ? {
              phase: 'referenceAnalysis',
              title: '参考分析未完成',
              detail: autoCurationWarnings.join('\n'),
              evidence: referenceIds,
            }
          : undefined
    contextTrace = {
      digest: bundle.digest,
      memoryRefs: bundle.memoryRefs,
      kitVersionRefs: bundle.kitVersionRefs,
      assetRefs: ([
        ...(await Promise.all(
          bundle.assets.map(async (asset) => {
            const mime = await input
              .readAssetMime(asset.hash)
              .catch(() => null)
            return mime
              ? {
                  hash: asset.hash,
                  mime,
                  role: asset.role,
                  name: asset.name,
                }
              : null
          }),
        )),
        ...(projected?.assetRefs ?? []),
      ] as (GenerationContextAsset & { mime: string } | null)[])
      .filter(
        (asset): asset is GenerationContextAsset & { mime: string } =>
          asset !== null,
      )
      .filter(
        (asset, index, all) =>
          all.findIndex((row) => row?.hash === asset.hash) === index,
      ),
      ...(projected?.evidence.length
        ? { referenceEvidence: projected.evidence }
        : {}),
      ...(referenceWarnings.length > 0
        ? { referenceWarnings }
        : {}),
      ...(referencePhaseEvent
        ? { referencePhaseEvent }
        : {}),
    }
    if (bundle.conflicts.length > 0) {
      return {
        kind: 'failed',
        persistedTurn,
        phase: 'context_conflict',
        message: `上下文有冲突，请先处理：${bundle.conflicts
          .map((conflict) => conflict.message)
          .join('；')}`,
        contextTrace,
      }
    }
    contextPrompt = [
      formatContextBundleForPrompt(bundle),
      projected?.prompt ?? '',
    ]
      .filter(Boolean)
      .join('\n\n')
    contextTrace.brief = contextPrompt
    const memoryCandidate = memoryCandidateFromText(plainText, {
      workbench: 'canvas',
      projectId: input.projectId,
      sessionId: input.session.id,
    })
    if (memoryCandidate) {
      contextPrompt +=
        `\n\n## 检测到长期记忆候选\n` +
        `用户本轮可能要求长期记住以下内容。若要保存，必须调用 rememberMemory 交给系统确认，不能直接在回复里声称已记住。\n` +
        JSON.stringify({
          text: memoryCandidate.text,
          kind: memoryCandidate.kind,
          scope: memoryCandidate.scope,
          ...(memoryCandidate.key
            ? { key: memoryCandidate.key }
            : {}),
          ...(memoryCandidate.expiresAt
            ? {
                expiresInDays: Math.max(
                  1,
                  Math.ceil(
                    (memoryCandidate.expiresAt - Date.now()) / 86_400_000,
                  ),
                ),
              }
            : {}),
        })
    }
  } catch (error) {
    contextTrace = null
    input.notifyContextError(
      `读取个人记忆或项目套件失败：${errText(error)}`,
    )
  }

  const support = await ensureToolSupport(
    {
      completeText: (request: TextRunRequest, signal: AbortSignal) =>
        input.routeExecution.execute({
          channelId: chatRoute.channelId,
          model: chatRoute.upstreamModel,
          modelIsUpstream: true,
          tools: request.tools ?? input.activeAgentTools,
          messages: request.messages ?? [],
          signal,
          routeCandidates: chatRoute.candidates,
          routePlanId: chatRoute.routePlanId,
          trace: directTextTrace({
            projectId: input.projectId,
            workbench: 'canvas',
            subjectId: input.session.id,
            scopeId: `session:${input.session.id}`,
            operationId,
            purpose: 'agent-tool-probe',
            channelId: chatRoute.channelId,
            model: chatRoute.upstreamModel,
            prompt: request.prompt,
            inputs: request.inputs,
            params: {
              messageCount: request.messages?.length ?? 0,
              toolMode: 'probe',
            },
          }),
          onRecordWarning: input.notifyRecordWarning,
          onRouteSucceeded: (selected) => {
            chatRoute.channelId = selected.channelId
            chatRoute.upstreamModel = selected.model
            if (selected.credentialGroupId) {
              chatRoute.credentialGroupId = selected.credentialGroupId
            } else {
              delete chatRoute.credentialGroupId
            }
            chatRoute.candidates = [
              selected,
              ...chatRoute.candidates.filter(
                (candidate) =>
                  candidate.channelId !== selected.channelId ||
                  candidate.credentialGroupId !==
                    selected.credentialGroupId ||
                  candidate.model !== selected.model,
              ),
            ]
          },
          ...(request.timeoutMs
            ? { timeoutMs: request.timeoutMs }
            : {}),
        }),
    },
    {
      channelId: chatRoute.channelId,
      model: chatRoute.logicalModel,
    },
    input.signal,
  )
  if (input.signal.aborted) {
    return {
      kind: 'failed',
      persistedTurn,
      phase: 'tool_probe',
      message: '用户已停止当前回合',
      contextTrace,
    }
  }
  const decision = decideToolMode(support)
  if (decision.kind === 'error') {
    return {
      kind: 'failed',
      persistedTurn,
      phase: 'tool_probe',
      message: decision.message,
      contextTrace,
    }
  }

  const clearedPendingAssets =
    sentAssetIds.length > 0
      ? (await input.sessions.clearPendingAssetIds(
          input.session.id,
          sentAssetIds,
        )) ?? undefined
      : undefined

  const skillChipIds = rawMentions
    .filter((mention) => mention.kind === 'skill')
    .map((mention) => mention.id)
  const skillId = resolveAgentSkillForTurn(
    skillChipIds,
    input.session.skillId,
  )
  const skill = skillId
    ? input.skills.find((item) => item.id === skillId)
    : undefined
  if (contextTrace && skill) {
    contextTrace.skillPhaseEvent = {
      phase: 'skillLoaded',
      title: '技能加载完成',
      detail: `已加载技能「${skill.name}」。`,
      evidence: [skill.id],
    }
  }
  const explicitMediaModels = explicitMediaModelsFromMentions(
    mentions,
    (model) => capabilityOfLogical(input.channels, model)?.category,
  )
  const mediaModels = {
    ...(input.session.imageModel
      ? { image: input.session.imageModel }
      : {}),
    ...(input.session.videoModel
      ? { video: input.session.videoModel }
      : {}),
  }
  const perImage = expectsPerImageFlows(
    plainText,
    mentionedImageIds.length,
  )
  const activeTaskPlan = activeTaskPlanForTask
  const previousMessages = previousMessagesForTask
  const lastAssistant = lastAssistantForTask
  const lastAssistantFailed = /HTTP\s*50\d|服务端返回错误|生成失败|运行失败|请求失败|上游/.test(
    lastAssistantTextForTask,
  )
  const requestMode = taskKey
  const promptProfile = promptProfileForMode(requestMode)
  const sessionBrief = requestMode === 'complex_plan'
    ? sessionBriefForContinuation({
        messages: previousMessages,
        promptProfile: 'light',
        ...(lastAssistantFailed
          ? { runRecord: { status: 'interrupted', reason: lastAssistant?.content } }
          : {}),
        taskPlan: activeTaskPlan,
        graphSummary: {
          nodes: input.graph.nodes.length,
          edges: input.graph.edges.length,
          generated: input.graph.nodes.filter((node) => {
            const data = node.data as { assetHash?: unknown } | undefined
            return typeof data?.assetHash === 'string' && data.assetHash.length > 0
          }).length,
        },
      })
    : undefined
  const turnTools = [
    ...agentToolsForRequestMode(requestMode, {
      canvasReview: input.canvasReviewEnabled,
    }),
  ]
  const referenceRootIds =
    requestMode === 'reference_edit'
      ? mentionedImageIds.length > 0
        ? mentionedImageIds
        : selectedImageIds
      : []
  const summary = summaryForAgentRequest(
    input.graph,
    requestMode,
    referenceRootIds,
  )
  const systemPrompt = buildAgentSystemPromptWithContext(
    summary,
    { model: chatRoute.logicalModel },
    {
      requestMode,
      promptProfile,
      canvasReviewEnabled: input.canvasReviewEnabled,
      imageInputAccepted: chatModelAcceptsImages(
        capabilityOfLogical(
          input.channels,
          chatRoute.logicalModel,
          chatRoute.channelId,
        ),
        imageInputsOf(collectAgentLoopInputs(
          input.graph.nodes,
          visualNodeIds,
          contextTrace?.assetRefs ?? [],
        )).length > 0,
      ),
      ...(looksLikePreserveRequest(plainText)
        ? { preserve: true }
        : {}),
      ...(looksLikeStyleOnlyRequest(plainText)
        ? { styleOnly: true }
        : {}),
      ...(perImage ? { perImage: true } : {}),
      assetIds: sentAssetIds,
      ...(skill
        ? { skill: { name: skill.name, content: skill.content } }
        : {}),
      ...(mentions.length > 0 ? { mentions } : {}),
      ...(Object.keys(mediaModels).length > 0 ? { mediaModels } : {}),
      generationAvailability: input.generationAvailability,
      autoRun: input.session.autoRun === true,
      ...(contextPrompt ? { contextBundle: contextPrompt } : {}),
      ...(activeTaskPlan
        ? { taskPlan: taskPlanPrompt(activeTaskPlan) }
        : {}),
      ...(sessionBrief ? { sessionBrief } : {}),
      ...(decision.mode === 'json'
        ? { jsonToolFallback: true, tools: turnTools }
        : {}),
    },
  )

  return {
    kind: 'ready',
    operationId,
    persistedTurn,
    chatRoute,
    plainText,
    mentions,
    visualNodeIds,
    sentAssetIds,
    contextPrompt,
    contextTrace,
    ...(skill ? { skill } : {}),
    explicitMediaModels,
    perImage,
    requestMode,
    promptProfile,
    toolMode: decision.mode,
    turnTools,
    systemPrompt,
    ...(clearedPendingAssets ? { clearedPendingAssets } : {}),
  }
}

function mergeExplicitReferences(
  selection: ReferenceSelection,
  explicitItems: readonly ReferenceItem[],
  taskKey: string,
): ReferenceSelection {
  const selectedByItem = new Map(
    selection.selected.map((row) => [row.item.id, row]),
  )
  for (const item of explicitItems) {
    if (selectedByItem.has(item.id)) continue
    selectedByItem.set(item.id, {
      item,
      usage: explicitReferenceUsage(item, taskKey),
    })
  }
  const explicitIds = new Set(explicitItems.map((item) => item.id))
  return {
    selected: [...selectedByItem.values()],
    omitted: selection.omitted.filter((row) => !explicitIds.has(row.item.id)),
  }
}

function explicitReferenceUsage(
  item: ReferenceItem,
  taskKey: string,
): ReferenceUsage {
  return {
    id: `explicit:${item.id}:${taskKey}`,
    itemId: item.id,
    projectId: item.projectId,
    taskKey,
    usage: 'style',
    howToUse:
      '用户通过参考 chip 明确选择本轮采用；按当前提示词把它作为视觉参考，不额外复制未要求的文字或身份。',
    createdAt: item.updatedAt,
  }
}

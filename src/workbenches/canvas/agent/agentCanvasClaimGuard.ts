import type { ChatMessage, ToolDeclaration } from '../../../domain/shared/execution/types'
import {
  AGENT_CONFIRM_TOOL_NAMES,
  AGENT_WRITE_TOOL_NAMES,
} from '../../../domain/agent/toolRegistry'
import { errorTextOf } from '../../../shared/result'
import { resultClaimProblems, resultFactsLine, turnResultFacts } from './agentResultClaimGuard'

/** 声称完成却没有执行证据时，拦下回答给用户的说明（两条收尾路径共用） */
export const BLOCKED_CLAIM_MESSAGE =
  '模型声称画布动作已完成（或承诺了当前不存在的能力），但本轮没有对应的成功执行记录；已拦下这次回答。请重试，或换一个对话模型。'

export type CanvasActionCategory =
  | 'rename'
  | 'delete'
  | 'move'
  | 'generate'
  | 'connect'
  | 'generic'

const RENAME_ACTION =
  /(改名|重命名|改(?:这个|那个|该|节点)?标题|换(?:这个|那个|该|节点)?标题|标题(?:改|换)|(?:修改|设置|改)(?:这个|那个|该|节点)?名称|节点名称)/
const DELETE_ACTION = /(删除|删掉|删了|移除|去掉)/
const MOVE_ACTION =
  /(移动|挪动|拖到|拖拽|放到|摆在|排列|排成|整理|对齐|布局|缩放|调整大小|尺寸)/
const GENERATE_ACTION = /(运行|执行|生成|出图|重跑|跑一遍)/
const CONNECT_ACTION = /(连线|连上|连接|断开)/
const ANY_CANVAS_ACTION =
  /(改名|重命名|改(?:这个|那个|该|节点)?标题|换(?:这个|那个|该|节点)?标题|标题(?:改|换)|(?:修改|设置|改)(?:这个|那个|该|节点)?名称|节点名称|移动|挪动|拖到|拖拽|放到|摆在|排列|排成|整理|对齐|布局|缩放|调整大小|删除|删掉|移除|去掉|断开|连线|连上|连接|运行|执行|生成|出图|重跑|跑一遍|新建节点|建节点|创建工作流)/
const NEGATED_CAPABILITY =
  /(没有|不具备|不支持|无法|没法|不能|不会|不可用|缺少|做不到|做不了|帮不了|改不了)/
const DONE_WEAK = /(已完成|已经完成|做完了|做好了|处理好了|搞定了)/
const PAST_REFERENCE = /(之前|刚才|上一轮|上一次|上周|前天)/

const DONE_STRONG: readonly [RegExp, CanvasActionCategory][] = [
  [/(已改好|已经改好|改好了|已经改成|改成了|改标题完成|已修改|修改好了|改完了|已改名|改名成功|重命名成功)/, 'rename'],
  [/(已删除|已经删除|删除成功|删除完成|删掉了|已移除|移除成功)/, 'delete'],
  [/(已移动|已经移动|移动好了|移动完成|已排列|排好了|已整理|整理好了|已对齐|对齐了|已缩放|调整好了)/, 'move'],
  [/(已生成|已经生成|生成好了|生成完成|已运行|运行完成|跑完了|已出图)/, 'generate'],
  [/(已连接|连好了|已断开)/, 'connect'],
]

export function canvasActionCategoryOf(
  text: string,
): CanvasActionCategory | null {
  if (RENAME_ACTION.test(text)) return 'rename'
  if (DELETE_ACTION.test(text)) return 'delete'
  if (MOVE_ACTION.test(text)) return 'move'
  if (GENERATE_ACTION.test(text)) return 'generate'
  if (CONNECT_ACTION.test(text)) return 'connect'
  if (ANY_CANVAS_ACTION.test(text)) return 'generic'
  return null
}

/**
 * 画布动作的否定结论也必须先有目录证据。
 * 用动作类别复用同一套词表，避免“改名认得出、改名称却漏掉”的两份规则。
 */
export function claimsMissingCapability(text: string): boolean {
  return text.split(/[。！？\n]/).some((sentence) => {
    if (!NEGATED_CAPABILITY.test(sentence)) return false
    return (
      canvasActionCategoryOf(sentence) !== null ||
      /(能力|功能|操作|工具)/.test(sentence)
    )
  })
}

/**
 * 每个类别需要哪种工具的**成功结果**才算证据。
 * `rename` 是空数组：仓库里没有暴露给 Agent 的改名工具，`updateNode`（改参数）不算。
 */
const EVIDENCE_TOOL_NAMES: Record<CanvasActionCategory, readonly string[]> = {
  rename: [],
  delete: ['deleteNodes', 'deleteEdges'],
  move: ['moveNodes', 'arrangeNodes', 'resizeNodes'],
  // applyPlan 只是建工作流，**不是真的生成**；"已生成/已出图"必须有 runNode / runFrom
  generate: ['runNode', 'runFrom'],
  connect: ['applyPlan'],
  generic: [...AGENT_WRITE_TOOL_NAMES, ...AGENT_CONFIRM_TOOL_NAMES],
}

export const toolResultFailed = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false
  const row = value as { ok?: unknown; problems?: unknown }
  return row.ok === false || (Array.isArray(row.problems) && row.problems.length > 0)
}

const toolResultSucceeded = (content: string): boolean => {
  try {
    const value = JSON.parse(content) as unknown
    if (!value || typeof value !== 'object' || toolResultFailed(value)) return false
    const error = (value as { error?: unknown }).error
    return !(typeof error === 'string' && error.trim())
  } catch {
    return false
  }
}

/** 本回合最后一用户消息之后，是否出现过该类别的成功画布工具结果。 */
export function hasSuccessfulCanvasMutation(
  messages: readonly ChatMessage[],
  category: CanvasActionCategory,
): boolean {
  const wanted = new Set(EVIDENCE_TOOL_NAMES[category])
  if (wanted.size === 0) return false
  const callNameById = new Map<string, string>()
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.role === 'user') break
    if (message.role !== 'assistant') continue
    for (const call of message.toolCalls ?? []) {
      callNameById.set(call.id, call.name)
    }
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.role === 'user') break
    if (message.role !== 'tool') continue
    const name =
      message.toolName || callNameById.get(message.toolCallId ?? '') || ''
    if (!wanted.has(name)) continue
    if (toolResultSucceeded(message.content)) return true
  }
  return false
}

/**
 * 正向承诺检测（保守）：同句必须同时有画布动作词 + 第一人称/征询语气。
 * 「建议你改名」「你可以自己改名」这类建议明确排除。
 */
export function claimsCanvasActionPromise(text: string): boolean {
  if (!ANY_CANVAS_ACTION.test(text)) return false
  for (const sentence of text.split(/[。！？\n]/)) {
    if (!ANY_CANVAS_ACTION.test(sentence)) continue
    if (/(建议|最好|不妨|你可以自己|你可以试试)/.test(sentence)) continue
    if (
      /(我(?:可以|能|来|会|将|先|马上|这就|立即|帮你|给你)|要不要我|需要我|要我|可以帮你|可以给你)/.test(
        sentence,
      )
    ) {
      return true
    }
  }
  return false
}

export function claimsCanvasActionDone(
  text: string,
): { category: CanvasActionCategory } | null {
  for (const sentence of text.split(/[。！？\n]/)) {
    if (!sentence.trim()) continue
    if (PAST_REFERENCE.test(sentence)) continue
    if (/(建议|推荐|不妨|你可以自己)/.test(sentence)) continue
    for (const [pattern, category] of DONE_STRONG) {
      if (pattern.test(sentence)) return { category }
    }
    if (DONE_WEAK.test(sentence)) {
      const category = canvasActionCategoryOf(sentence)
      if (category) return { category }
    }
  }
  return null
}

export interface CanvasClaimGuardActivity {
  id: string
  phase: 'tool'
  status: 'running' | 'done' | 'failed'
  tool: string
}

type DiscoveredTools = {
  result: unknown
  tools: readonly ToolDeclaration[]
}

export interface AgentCanvasClaimGuardPorts {
  messages: ChatMessage[]
  allowedToolNames: ReadonlySet<string>
  discoverCapabilities?: (args: unknown) => Promise<DiscoveredTools>
  loadDiscoveredTools: (discovered: DiscoveredTools) => readonly string[]
  emitActivity: (activity: CanvasClaimGuardActivity) => void
  emitProgress: () => void
}

export interface AgentCanvasClaimGuard {
  discoverBeforeCapabilityDenial(text: string, step: number): Promise<boolean>
  guardFinalCanvasClaims(
    text: string,
    step: number,
  ): Promise<'ok' | 'continue' | 'blocked'>
  noteCapabilityDiscoveryRan(): void
  /** 核对后仍与真实结果不符时，在回答末尾附上 readResult 的真实尺寸 / 张数（A7） */
  verifiedFinalText(text: string): string
}

/**
 * 能力目录与执行证据的唯一门禁。
 *
 * `agentLoop` 只负责在最终回答处调用这里，不拥有动作词表、证据表或补查状态。
 * 这样新增画布动作时改一个模块，不会把主循环重新堆成上帝文件。
 */
export function createAgentCanvasClaimGuard(
  ports: AgentCanvasClaimGuardPorts,
): AgentCanvasClaimGuard {
  let capabilityDiscoveryRan = false
  let promiseGateRan = false
  let completionGateRan = false
  let resultGateRan = false

  const lastUserRequestOf = (): string =>
    [...ports.messages]
      .reverse()
      .find((message) => message.role === 'user')?.content ?? ''
  const capabilityQueryOf = (text: string): string =>
    `${lastUserRequestOf()}\n${text}`.trim().slice(0, 2000)
  const capabilityAvailableFor = (category: CanvasActionCategory): boolean =>
    EVIDENCE_TOOL_NAMES[category].some((name) =>
      ports.allowedToolNames.has(name),
    )

  const runCapabilityDiscovery = async (
    step: number,
    query: string,
    intro: string,
  ): Promise<void> => {
    capabilityDiscoveryRan = true
    ports.emitActivity({
      id: `capability-gate-${step}`,
      phase: 'tool',
      status: 'running',
      tool: 'readCapabilities',
    })
    try {
      const discovered = await ports.discoverCapabilities!({ query })
      const loaded = ports.loadDiscoveredTools(discovered)
      ports.emitActivity({
        id: `capability-gate-${step}`,
        phase: 'tool',
        status: toolResultFailed(discovered.result) ? 'failed' : 'done',
        tool: 'readCapabilities',
      })
      ports.messages.push({
        role: 'system',
        content:
          `${intro}\n` +
          `本轮新加载工具：${loaded.length > 0 ? loaded.join('、') : '无'}\n` +
          `能力目录：${JSON.stringify(discovered.result)}`,
        createdAt: Date.now(),
      })
    } catch (error) {
      ports.emitActivity({
        id: `capability-gate-${step}`,
        phase: 'tool',
        status: 'failed',
        tool: 'readCapabilities',
      })
      ports.messages.push({
        role: 'system',
        content:
          '能力目录读取失败；这是目录读取故障，不能据此断言某项能力不存在。' +
          `错误：${errorTextOf(error)}`,
        createdAt: Date.now(),
      })
    }
    ports.emitProgress()
  }

  const discoverBeforeCapabilityDenial = async (
    text: string,
    step: number,
  ): Promise<boolean> => {
    if (
      capabilityDiscoveryRan ||
      !ports.discoverCapabilities ||
      !claimsMissingCapability(text)
    ) {
      return false
    }
    await runCapabilityDiscovery(
      step,
      capabilityQueryOf(text),
      '执行层已自动读取能力目录，禁止在未检查该结果时继续断言“没有能力”。',
    )
    return true
  }

  /**
   * 完成说明里的尺寸 / 张数 / 出图模型必须与本轮真实结果一致（Agent 实测 Bug A7）。
   * 第一次不符：回填真实差异，要求先 readResult 再改写；仍不符由 verifiedFinalText 附事实行。
   */
  const guardResultClaims = (text: string): 'ok' | 'continue' => {
    if (resultGateRan) return 'ok'
    const problems = resultClaimProblems(text, turnResultFacts(ports.messages))
    if (problems.length === 0) return 'ok'
    resultGateRan = true
    ports.messages.push({
      role: 'system',
      content:
        '完成说明与本轮真实结果不符，不能作为最终回答：\n' +
        problems.map((problem) => `- ${problem}`).join('\n') +
        '\n尺寸、张数、出图模型只能照 runNode 的 outcomes 与运行后 readResult 的真实结果写；' +
        '还没调用 readResult 就先调用它，再改写回答。不确定的不写。',
      createdAt: Date.now(),
    })
    ports.emitProgress()
    return 'continue'
  }

  const guardFinalCanvasClaims = async (
    text: string,
    step: number,
  ): Promise<'ok' | 'continue' | 'blocked'> => {
    const promisesAction = claimsCanvasActionPromise(text)
    if (
      promisesAction &&
      !capabilityDiscoveryRan &&
      ports.discoverCapabilities
    ) {
      await runCapabilityDiscovery(
        step,
        capabilityQueryOf(text),
        '执行层检测到本轮准备承诺一个画布动作，但尚未读取能力目录；已自动补查。' +
          '在确认对应工具存在之前，不得承诺“我可以做”。',
      )
      return 'continue'
    }
    if (promisesAction) {
      const category = canvasActionCategoryOf(text)
      if (category && !capabilityAvailableFor(category)) {
        if (!capabilityDiscoveryRan && ports.discoverCapabilities) {
          await runCapabilityDiscovery(
            step,
            capabilityQueryOf(text),
            '执行层检测到本轮准备承诺一个画布动作，但尚未确认该能力是否存在；已自动补查。',
          )
          return 'continue'
        }
        if (promiseGateRan) return 'blocked'
        promiseGateRan = true
        ports.messages.push({
          role: 'system',
          content:
            `当前可用的工具里没有能完成「${category}」的能力（本回合工具集与能力目录都不包含它）。` +
            '不得向用户承诺“我可以做”或“要不要我做”；必须直接说明当前没有这项能力。',
          createdAt: Date.now(),
        })
        ports.emitProgress()
        return 'continue'
      }
    }
    const claim = claimsCanvasActionDone(text)
    if (!claim || hasSuccessfulCanvasMutation(ports.messages, claim.category)) {
      return guardResultClaims(text)
    }
    if (completionGateRan) return 'blocked'
    completionGateRan = true
    ports.messages.push({
      role: 'system',
      content:
        `执行层没有找到本回合与「${claim.category}」对应的成功工具结果，` +
        '因此你声称的“已完成 / 已改好”没有执行证据，不能作为最终回答。' +
        '要么现在调用真实工具完成动作，要么如实告诉用户还没做、以及当前是否根本没有这项能力' +
        '（能力不存在时先 readCapabilities 再明确说“当前没有该能力”）。',
      createdAt: Date.now(),
    })
    ports.emitProgress()
    return 'continue'
  }

  return {
    discoverBeforeCapabilityDenial,
    guardFinalCanvasClaims,
    noteCapabilityDiscoveryRan: () => {
      capabilityDiscoveryRan = true
    },
    verifiedFinalText: (text) => {
      const facts = turnResultFacts(ports.messages)
      return resultClaimProblems(text, facts).length === 0
        ? text
        : `${text}\n\n${resultFactsLine(facts)}`
    },
  }
}

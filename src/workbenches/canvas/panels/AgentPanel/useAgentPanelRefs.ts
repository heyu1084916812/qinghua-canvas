import { useRef } from 'react'
import type { ToolDeclaration } from '../../../../domain/shared/execution/types'
import type { AgentToolRequest } from '../../agent/agentLoop'
import { AgentSessionRuntimeState } from './agentSessionRuntime'
import type { AgentTurnContextTrace } from './agentTurnRequest'

/**
 * 面板里**所有按会话分桶的瞬时状态**，只有这一份。
 *
 * 这些 Map / Set 之前散在 `AgentPanel` 里；把面板拆成「会话 / 回合 / 工具」三个领域之后，
 * 它们必须仍然只有一个宿主：同一个 Map 若被两个 hook 各自 `useRef` 起来，就是**两份状态**，
 * A 写的 B 读不到 —— 表现为「停止按钮停不掉」「切换会话后引导丢了」这类最难的 bug。
 *
 * 所以：本文件是唯一的创建处，三个领域 hook 只**接收引用**、不重新创建。
 * `agentPanelArchitecture.test.ts` 会钉住这一点（`new Map(` / `new Set(` 只许出现在这里）。
 */
export function useAgentPanelRefs() {
  /** 队列泵：一个会话同时只允许一个在跑 */
  const queuePumpingRef = useRef(new Set<string>())
  /** 确认卡正在执行（互斥：确认 / 取消 / 自动执行共用） */
  const confirmingRef = useRef(new Set<string>())
  /** 停止正在收口中 */
  const stoppingRef = useRef(new Set<string>())
  /** 已批准、正在执行的确认工具；停止时要给这条 tool_call 补一个中断结果。 */
  const inFlightConfirmationRef = useRef(new Map<string, AgentToolRequest>())
  /** 队列泵本体：队列控制器赋值，发送路径调用 */
  const queuePumpRef = useRef<(sessionId: string) => void>(() => {})
  /**
   * 不参与渲染、但要跨确认 / 暂停续跑的瞬时状态。
   *
   * 所有字段按 sessionId 分桶：A 会话多图拆分、上次模型都不能串到并行运行的 B。
   */
  const sessionRuntimeRef = useRef(new AgentSessionRuntimeState())
  /**
   * 中止用的控制器**按会话各存一个**（与 `statusBySession` 同一口径）。
   *
   * 早先只有一份 `abortRef`：在 B 里点发送会把 A 的那份覆盖掉，A 就再也停不下来；
   * 反过来「停止」也只停得到最后发出去的那一条。两个会话各跑各的，控制器也得各是各的。
   */
  const abortRefs = useRef(new Map<string, AbortController>())
  /** 每个会话这个回合走的是原生 tools 还是 JSON 降级；确认后续跑要沿用同一条 */
  const toolModeRef = useRef(new Map<string, 'native' | 'json'>())
  const turnToolsRef = useRef(new Map<string, readonly ToolDeclaration[]>())
  const currentTurnIdRef = useRef(new Map<string, string>())
  const currentTurnJobIdRef = useRef(new Map<string, string>())
  const currentTurnRevisionRef = useRef(new Map<string, number>())
  const planAliasesRef = useRef(new Map<string, Map<string, string>>())
  /** 自动执行路径调用的「确认最新一张卡」，由确认控制器赋值 */
  const confirmRef = useRef<() => Promise<unknown>>(() => Promise.resolve())
  /** 本轮正文里明确 @ 的图片 / 视频模型；只约束这一次用户回合。 */
  const explicitMediaModelsRef = useRef(
    new Map<string, { image?: string; video?: string }>(),
  )
  /** 已投递的引导，按会话分桶；收口时按它判断接力 */
  const deliveredSteersRef = useRef(new Map<string, Set<string>>())
  /** 本回合的工具上下文素材轨迹（跑节点 / 生成时现取） */
  const contextTraceRef = useRef(new Map<string, AgentTurnContextTrace>())

  return {
    queuePumpingRef,
    confirmingRef,
    stoppingRef,
    inFlightConfirmationRef,
    queuePumpRef,
    sessionRuntimeRef,
    abortRefs,
    toolModeRef,
    turnToolsRef,
    currentTurnIdRef,
    currentTurnJobIdRef,
    currentTurnRevisionRef,
    planAliasesRef,
    confirmRef,
    explicitMediaModelsRef,
    deliveredSteersRef,
    contextTraceRef,
  }
}

export type AgentPanelRefs = ReturnType<typeof useAgentPanelRefs>

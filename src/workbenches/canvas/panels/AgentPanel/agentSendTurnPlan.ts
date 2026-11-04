import type { AgentTurnOrigin } from '../../../../features/shared/agent/AgentController'
import { agentTaskPlanProgress } from '../../../../domain/agent/taskPlan'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { IDLE_STATUS, type AgentPanelStatus } from './AgentActivityViews'

/**
 * `runSendText` 的**开跑前纯决策**（A1 刀）。
 *
 * ── 验收清单：下面 10 条顺序**不可调换**，改动这一块时逐条打勾 ──
 * 标 ✅ 的由本文件（A1）的纯函数钉死或已保持不变；标 🅰️2 的要等下一步把主体
 * 搬进端口化函数（A2）才动，届时以本清单为回归基线。
 *
 *  1. 清 `currentTurnJobIdRef` 必须在 prepare 之前（同步）。           🅰️2（ref 端口）
 *  2. 清 taskPlan 必须在 prepare 之前。                              ✅ `shouldClearTaskPlan`
 *  3. prepare 内部 `onPersisted` 先于 `onRouteReady`。                🅰️2（prepare 内部顺序）
 *  4. contextTrace / toolMode / explicit / perImage / turnTools 必须
 *     在 `loopDeps(...)` 之前（loopDeps 按 ref 现取这些值）。          🅰️2
 *  5. `loopDeps` 先于 `runAgentTurn`。                              🅰️2
 *  6. `runAgentTurn` → `continueAutoConfirmations` → `handleOutcome`。 🅰️2
 *  7. `failBeforeModel` 只在 `kind === 'failed'` 分支、且在该分支
 *     `return` 之前执行；payload 与 status 由本文件生成。             ✅ 数据 + 🅰️2 位置
 *  8. `routeReady = true` 先于 `ensureAgentJob`。                    🅰️2
 *  9. `abortRefs.set` 先于 `setStatus('thinking')`。                 🅰️2
 * 10. `return outcome` 必须在 `handleOutcome` 之后。                 🅰️2
 *
 * 特别提醒（A2 别踩）：`failBeforeModel` 里 `turnAbort.signal.aborted` 是**读两次**的
 * ——payload 用进入函数时的值，status 用 `failTurn` 之后的**最新值**。这中间有一次
 * `await`，用户正好在这段时间点停止时，旧行为会落到 idle 而不是 error；合成一次读取
 * 会悄悄改掉这个语义。
 */

export interface SendTurnSeedInput {
  session: AgentSession
  /**
   * A2 的端口函数会用正文；A1 的种子只按会话与 id 决定初值，所以这里只收不用。
   */
  text: string
  actualTurnId: string
  /** 队列回合的 turnId；直接发送时为 undefined（**不能**用 actualTurnId 顶替）。 */
  queueTurnId?: string
}

export interface SendTurnSeed {
  /**
   * 只含 `turnId` / `queueTurnId` 两个初值。
   *
   * `jobId` 要等 `onRouteReady` 建完 Job 才知道、`messageRevision` 要等用户消息
   * 落库（`onPersisted`）才有 —— 提前塞进来只会让 failTurn / settle 读到假 origin。
   */
  turnOrigin: AgentTurnOrigin
  /** 这一轮该不该先把上一份「非进行中」的计划清掉（在 prepare 之前）。 */
  clearTaskPlan: boolean
}

/**
 * 是否需要在发送前清掉会话上的旧计划。
 *
 * 口径：有计划、且 `agentTaskPlanProgress` 判定它**不是** `active`（completed / failed）
 * 时才清；进行中的计划要留着，准备阶段还要按它拼上下文。
 */
export function shouldClearTaskPlan(session: AgentSession): boolean {
  const plan = session.taskPlan
  if (!plan) return false
  return agentTaskPlanProgress(plan).status !== 'active'
}

/** 发送回合的种子：origin 初值 + 清计划判定。纯函数，无副作用。 */
export function sendTurnSeed(input: SendTurnSeedInput): SendTurnSeed {
  return {
    turnOrigin: {
      turnId: input.actualTurnId,
      queueTurnId: input.queueTurnId,
    },
    clearTaskPlan: shouldClearTaskPlan(input.session),
  }
}

export interface FailureTurnInput {
  message: string
  phase: string
  aborted: boolean
  origin: AgentTurnOrigin
}

/** `controller.failTurn` 的入参：`reason` 就是给用户看的那句文案。 */
export interface AgentTurnFailure {
  reason: string
  phase: string
  aborted: boolean
  origin: AgentTurnOrigin
}

export function failureTurnPayload(
  input: FailureTurnInput,
): AgentTurnFailure {
  return {
    reason: input.message,
    phase: input.phase,
    aborted: input.aborted,
    origin: input.origin,
  }
}

/**
 * 模型请求失败后的展示状态：用户自己停的 → 直接回 idle（不弹红字），
 * 其它失败 → 红字，文案就是 `message`。
 */
export function failureStatus(
  aborted: boolean,
  message: string,
): AgentPanelStatus {
  return aborted ? IDLE_STATUS : { kind: 'error', message }
}

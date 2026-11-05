import type { ChatMessage } from '../../domain/shared/execution/types'
import type { QueuedAgentTurn } from '../../domain/agent/queuedTurn'
import type { AgentSteer } from '../../domain/agent/steering'
import type { AgentTaskPlan } from '../../domain/agent/taskPlan'
import type { ConfirmationRequestRef } from '../../domain/agent/confirmation'
import type { AgentToolName } from '../../domain/agent/toolRegistry'

export interface AgentSession {
  id: string
  /** 属于哪个项目（画布）。会话列表按它过滤 */
  projectId: string
  title: string
  /** 本会话用的渠道与模型（§8「每个会话可单独选模型」） */
  channelId: string
  /** 对话模型 = **agent 自己**跑的那个 LLM（用户 2026-10-03：「对话模型就是这个 agent 的 llm 模型」） */
  model: string
  /**
   * 用户点选的**图片 / 视频模型**（用户 2026-10-03：「我创作面板有什么模型就用什么模型，
   * 分了图片和视频…也就是说模型有三个选项」）。
   *
   * 它们不参与 agent 自己的推理，而是**建生成节点时用的配方**：计划里那个节点是
   * 文生图还是图生视频，就按对应这一类套上去（见 `modelForGenerated`）。
   */
  imageModel?: string
  videoModel?: string
  /**
   * 本会话启用的技能（设计文档 §14 M4）。
   *
   * 存 **id** 而不是正文快照：技能在技能库里可以随时改，存正文等于把那一刻冻结住，
   * 用户改完技能、老会话却还用旧版 —— 与画布节点上的 `skillId` 同一口径。
   */
  skillId?: string
  /**
   * **自动生成**（用户 2026-10-02：参考产品图一的「手动生成 / 自动生成」）。
   *
   * `false` / 缺省 = 手动：写与花钱的动作都停下等确认（设计文档 §9 的默认值，
   * **必须是默认** —— 默认自动花钱不是本项目愿意替用户做的决定）。
   * `true` = 自动：agent 请求执行 / 落地时不再打断，它自己往下跑。
   */
  autoRun?: boolean
  /**
   * **回读轮数**（用户 2026-10-14 参考产品图二：「回读这个抄一下」）。
   *
   * 发给模型的**上下文窗口**：只带最近 N 条消息。更早的仍留在库里（`messages`
   * 始终是全量，界面照常回看）—— 窗口只决定「这次问模型时它看得到多少」。
   * 不设 = `AGENT_CONTEXT_WINDOW`（20）。
   *
   * 为什么需要一道闸：Agent 每一轮都会往历史里追加工具结果，跑完一批节点之后
   * 单条 tool 消息可能非常大；窗口管的是「条数不无限增长」，
   * 单条的体积仍要靠别的办法（见 §4.3 的说明）。
   */
  contextWindow?: number
  /**
   * 用户随对话给出的素材（设计文档 §8「输入：文字 + 可选图片」）。
   *
   * 存的是**画布上的节点 id**，不是文件字节：素材一进来就落成画布上的节点
   * （复用既有的导入链路），这样 agent 能用 `attach` 复用同一条素材，
   * 而不是把图片塞进对话上下文里再让它猜。
   */
  pendingAssetIds?: string[]
  /**
   * 当前回合尚未结束时，用户继续提交的任务。
   *
   * 队列随会话落库，切走会话或关闭面板不会丢；这里只保存**尚未领取**的任务。
   * 队列泵领取时会原子移出，并写入 `activeTurn`，避免运行中的消息继续显示成等待项。
   */
  queuedTurns: QueuedAgentTurn[]
  /** 已被队列泵领取、尚未最终完成的队首任务。 */
  activeTurnId?: string
  activeTurnStartedAt?: number
  /** 被领取回合的完整冻结快照；失败 / 中断时原子放回等待队列。 */
  activeTurn?: QueuedAgentTurn
  /** 当前运行回合尚未送入模型上下文、或尚未完成写回的引导消息。 */
  pendingSteers: AgentSteer[]
  /** 重启后仍需恢复的确认卡。工具参数只存结构副本，不存执行结果。 */
  pendingConfirmation?: {
    callId: string
    name: string
    args: unknown
  }
  /**
   * 与 pendingConfirmation / continuation 同寿命的本轮工具白名单。
   * 面板重载后必须先恢复这份名单；缺失时失败关闭，不能回退到全量工具。
   */
  allowedToolNames?: AgentToolName[]
  /** 当前会话最近一次获批的多阶段执行计划。 */
  taskPlan?: AgentTaskPlan
  /**
   * 可继续的长任务检查点。
   *
   * 消息与工具结果已经保存在 `messages`；这里只标记“上一段是安全暂停，不是失败”，
   * 页面重载后仍显示继续按钮，且继续时不会重新发起已完成的工具调用。
   */
  continuation?: {
    reason: 'max_steps'
    maxSteps: number
    createdAt: number
    /** 暂停任务来自队列时，保留原队列项 id。 */
    queuedTurnId?: string
  }
  /** **全部历史**（展示与回溯）。发给模型的是它的窗口，见 `contextFor` */
  messages: ChatMessage[]
  /** 每次真正替换消息正文时递增；旧数据缺省为 0。 */
  messageRevision?: number
  createdAt: number
  updatedAt: number
}


export interface AgentSessionStore {
  /**
   * 列某个项目的会话。`messages` 在这里固定为空，列表页不再读取消息正文。
   * 打开会话时用 `get` / `messagesFor` 按会话读取。
   */
  list(projectId: string): Promise<AgentSession[]>
  get(id: string): Promise<AgentSession | null>
  /** 按稳定 sequence 读取某个会话的全部消息。 */
  messagesFor(id: string): Promise<ChatMessage[]>
  /** 把旧版 `agentSessions.messages` 一次性拆到 `agentMessages`。 */
  migrateLegacyMessages(): Promise<void>
  create(input: {
    projectId: string
    channelId: string
    /** 对话模型（agent 自己的 LLM） */
    model: string
    title?: string
    /** 建生成节点时默认用的图片 / 视频模型（用户 2026-10-03 的三档选择） */
    imageModel?: string
    videoModel?: string
    /** 新建会话时可直接带入的技能；仍保持单技能契约 */
    skillId?: string
  }): Promise<AgentSession>
  save(session: AgentSession): Promise<void>
  /** 字段级更新；不会用 UI 的旧快照覆盖消息或队列。 */
  updateFields(
    id: string,
    patch: Partial<Omit<AgentSession, 'id' | 'projectId' | 'messages' | 'queuedTurns' | 'createdAt'>>,
  ): Promise<AgentSession | null>
  /**
   * 只更新历史消息。
   *
   * 回合执行期间用户可能继续入队；如果结束时拿开局那份旧 session 整行覆盖，
   * 后入队的任务会被悄悄抹掉。所有后台写回都走这里，只改自己拥有的字段。
   */
  saveMessages(id: string, messages: ChatMessage[]): Promise<AgentSession | null>
  /** 普通 outcome 的消息与同寿命字段在同一事务按 revision CAS 写入。 */
  applyAgentOutcome(
    id: string,
    input: {
      expectedRevision?: number
      messages: readonly ChatMessage[]
      pendingConfirmation?: AgentSession['pendingConfirmation']
      continuation?: AgentSession['continuation']
      allowedToolNames?: readonly AgentToolName[]
      removeSteerIds?: readonly string[]
    },
  ): Promise<{ ok: true; session: AgentSession } | { ok: false; reason: 'missing' | 'conflict' }>
  /**
   * 迟到确认的原子补救。
   *
   * 只基于库里的最新消息补缺失的 interrupted 工具结果；只有当前确认卡仍属于
   * 同一个 `callId` 时才清 pendingConfirmation / continuation / allowedToolNames。
   * 这样旧回合的迟到结果不会覆盖后来新回合的消息或确认卡。
   */
  settleInterruptedConfirmation(
    id: string,
    request: ConfirmationRequestRef,
  ): Promise<AgentSession | null>
  /** stop / cancel 基于存储最新历史原子补结果，只清仍匹配的旧确认字段。 */
  settleInterruptedSession(
    id: string,
    request: ConfirmationRequestRef | undefined,
    result: 'canceled' | 'interrupted',
    expectedRevision?: number,
  ): Promise<AgentSession | null>
  /**
   * 追加待发送附件（**原子**读改写，事务内 load → 追加 → 去重 → 写回）。
   *
   * `pendingAssetIds` 有多个写者：三条投递路径（文件 / 素材库 / 画布投递）、删 chip 时的
   * 整字段同步、发送后的 `clearPendingAssetIds`。以前投递路径拿**渲染快照**读-改-写：
   * 两次快速投递都基于同一份旧基线，后写覆盖先写 ⇒ 丢一条记账（#919 P3）。
   * 这里把「读」搬进事务，追加永远落在这个字段的**最新值**上 —— 既不会丢并发追加，
   * 也不会把用户刚删掉的 id 带回库里。
   */
  appendPendingAssetIds(
    id: string,
    assetIds: readonly string[],
  ): Promise<AgentSession | null>
  clearPendingAssetIds(id: string, assetIds: readonly string[]): Promise<AgentSession | null>
  enqueueTurn(
    id: string,
    turn: QueuedAgentTurn,
  ): Promise<{ ok: true; session: AgentSession } | { ok: false; reason: 'missing' | 'empty' | 'full' }>
  removeQueuedTurn(id: string, turnId: string): Promise<AgentSession | null>
  updateQueuedTurnText(
    id: string,
    turnId: string,
    text: string,
  ): Promise<AgentSession | null>
  promoteQueuedTurnToSteer(
    id: string,
    turnId: string,
    steerId: string,
  ): Promise<
    | { ok: true; session: AgentSession }
    | {
        ok: false
        reason:
          | 'missing'
          | 'has_assets'
          | 'steer_full'
          | 'awaiting_confirmation'
          /** 这条 turn 正在发送中（已被 pump 领取），不能再转成引导。 */
          | 'active'
      }
  >
  /**
   * 修复旧版本留下的坏状态：确认卡与待发送引导同时存在。
   *
   * 引导被转成普通排队项，确认调用补一条 canceled 工具结果后清除；
   * 返回 null 表示这条会话本来就不需要修复。
   */
  repairConfirmationSteerCollision(id: string): Promise<AgentSession | null>
  enqueueSteer(
    id: string,
    steer: AgentSteer,
  ): Promise<
    | { ok: true; session: AgentSession }
    | { ok: false; reason: 'missing' | 'empty' | 'full' }
  >
  removeSteers(id: string, steerIds: readonly string[]): Promise<AgentSession | null>
  /** 原子领取队首；任务仍留在队列，避免进程在启动前丢任务。 */
  claimNextQueuedTurn(id: string): Promise<{ session: AgentSession; turn: QueuedAgentTurn } | null>
  /** 结束已领取任务；完成时移出队列，失败 / 中断时保留供手动继续。 */
  finishActiveQueuedTurn(
    id: string,
    turnId: string,
    completed: boolean,
  ): Promise<AgentSession | null>
  /** 恢复时清掉进程中断留下的活动标记，不删除队列任务。 */
  releaseActiveTurn(id: string): Promise<AgentSession | null>
  rename(id: string, title: string): Promise<void>
  remove(id: string): Promise<void>
  /**
   * 某个会话**此刻该发给模型的消息**。
   *
   * 只取这一个会话的，且按窗口截断 —— 这是「记忆隔离」在代码上的落点。
   */
  contextFor(id: string, window?: number): Promise<ChatMessage[]>
}

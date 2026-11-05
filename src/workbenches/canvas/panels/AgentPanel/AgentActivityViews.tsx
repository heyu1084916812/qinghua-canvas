import { useEffect, useRef, useState } from 'react'
import type {
  AgentLoopActivity,
  AgentToolRequest,
} from '../../agent/agentLoop'
import { useAsset } from '../../../../features/shared/assets/index'
import { useCanvasStore } from '../../storeContext'
import {
  IconCheck,
  IconChevronDown,
  IconClose,
} from '../../toolbar/icons'
import {
  agentToolActivitySummary,
  conciseAgentRequest,
} from './agentActivitySummary'
import { agentRevealCharacters } from './agentOutputReveal'
import {
  expandedProcessView,
  latestProcessLine,
} from './agentProcessText'
import {
  agentRunTaskCounts,
  agentRunTaskTitle,
  formatAgentRunElapsed,
  type AgentRunTask,
} from './agentRunTasks'
import {
  toolRunningLabel,
  type ConversationItem,
  type ConversationProcessEntry,
} from './conversation'
import { MarkdownBlocks } from '../../text/MarkdownBlocks'
import baseStyles from './AgentPanel.module.css'
import activityStyles from './AgentActivityViews.module.css'

const styles = { ...baseStyles, ...activityStyles }

export type AgentPanelStatus =
  | { kind: 'idle' }
  | { kind: 'thinking' }
  | { kind: 'toolRunning' }
  | { kind: 'awaitingConfirm'; request: AgentToolRequest }
  | { kind: 'paused'; message: string }
  | { kind: 'executing'; tool?: string }
  | { kind: 'error'; message: string }

/** 单例的空闲态：按会话取状态时的兜底值，**必须是同一个对象**（否则每次都换引用，依赖数组炸） */
export const IDLE_STATUS: AgentPanelStatus = { kind: 'idle' }

export const STATUS_LABEL: Record<AgentPanelStatus['kind'], string> = {
  idle: '',
  thinking: '思考中',
  toolRunning: '正在看画布',
  awaitingConfirm: '等你确认',
  paused: '本轮已暂停',
  executing: '正在执行',
  error: '出错',
}

export const GENERATION_ACTIVITY_PHRASES = [
  '别急，图马上出来',
  '正在把画面整理好',
  '生成任务正在推进',
  '快好了，正在检查结果',
] as const

export function statusIsBusy(status: AgentPanelStatus): boolean {
  return status.kind !== 'idle' && status.kind !== 'error'
}

export function statusCanSteer(status: AgentPanelStatus): boolean {
  return (
    status.kind === 'thinking' ||
    status.kind === 'toolRunning' ||
    status.kind === 'awaitingConfirm' ||
    status.kind === 'executing'
  )
}

export function activityTextOf(
  status: AgentPanelStatus,
  generationPhraseIndex: number,
  items: readonly ConversationItem[],
  activities: readonly AgentLoopActivity[],
): string {
  if (status.kind === 'executing') {
    if (status.tool === 'runNode' || status.tool === 'runFrom') {
      return GENERATION_ACTIVITY_PHRASES[
        generationPhraseIndex % GENERATION_ACTIVITY_PHRASES.length
      ]!
    }
    return '正在执行这一步操作'
  }
  if (status.kind === 'thinking') {
    const lastUser = [...items].reverse().find((item) => item.kind === 'user')
    const request = conciseAgentRequest(lastUser?.kind === 'user' ? lastUser.text : '')
    return request ? `正在理解你的要求：${request}` : '正在理解你的要求'
  }
  if (status.kind === 'toolRunning') {
    const latest = [...activities]
      .reverse()
      .find((activity) => activity.status === 'running')
    return agentToolActivitySummary(
      latest?.phase === 'thinking'
        ? '正在理解你的要求'
        : toolRunningLabel(latest?.tool),
    )
  }
  if (status.kind === 'awaitingConfirm') return '这一步需要你确认'
  return STATUS_LABEL[status.kind]
}

export function AgentGenerationTasks({ tasks }: { tasks: readonly AgentRunTask[] }) {
  const counts = agentRunTaskCounts(tasks)
  const active = counts.running > 0 || counts.queued > 0
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setNow(Date.now())
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [active])

  return (
    <section
      className={styles.runTasks}
      data-agent-run-tasks
      data-agent-run-task-count={tasks.length}
      aria-label={agentRunTaskTitle(tasks)}
    >
      <div className={styles.runTasksHead}>
        <span
          className={active ? styles.runTasksDotActive : styles.runTasksDot}
          aria-hidden="true"
        />
        <span className={styles.runTasksTitle} aria-live="polite">
          {agentRunTaskTitle(tasks)}
        </span>
        <span className={styles.runTasksCount}>
          {counts.done + counts.failed}/{counts.total}
        </span>
      </div>
      <div className={styles.runTaskList}>
        {tasks.map((task) => {
          const startedAt = task.startedAt
          const finishedAt = task.finishedAt ?? (task.status === 'running' ? now : undefined)
          const elapsed =
            startedAt !== undefined && finishedAt !== undefined
              ? formatAgentRunElapsed((finishedAt - startedAt) / 1_000)
              : ''
          const statusLabel =
            task.status === 'queued'
              ? '排队中'
              : task.status === 'running'
                ? '生成中'
                : task.status === 'done'
                  ? '已完成'
                  : '失败'
          return (
            <div
              key={task.nodeId}
              className={styles.runTaskRow}
              data-agent-run-task-node={task.nodeId}
              data-agent-run-task-status={task.status}
              title={task.error || task.title}
            >
              <span className={styles.runTaskIcon} aria-hidden="true">
                {task.status === 'running' ? (
                  <span className={styles.runTaskSpinner} />
                ) : task.status === 'failed' ? (
                  <IconClose size={12} />
                ) : task.status === 'done' ? (
                  <IconCheck size={12} />
                ) : (
                  <span className={styles.runTaskQueuedDot} />
                )}
              </span>
              <span className={styles.runTaskName}>{task.title}</span>
              <span className={styles.runTaskStatus}>{statusLabel}</span>
              <span className={styles.runTaskElapsed}>
                {elapsed
                  ? task.status === 'running'
                    ? `已处理 ${elapsed}`
                    : `用时 ${elapsed}`
                  : ''}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function TypewriterActivity({
  text,
  live,
  textKey,
  current = false,
  markdown = false,
  body = false,
}: {
  text: string
  live: boolean
  textKey: string
  current?: boolean
  markdown?: boolean
  body?: boolean
}) {
  const [visible, setVisible] = useState(text)
  const [typing, setTyping] = useState(false)
  const visibleRef = useRef(text)

  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!live || reduceMotion || text.length === 0) {
      setVisible(text)
      setTyping(false)
      return
    }

    const current = visibleRef.current
    const characters = agentRevealCharacters(text)
    const currentCharacters = agentRevealCharacters(current)
    const canContinue =
      current.length > 0 &&
      characters.slice(0, currentCharacters.length).join('') === current
    if (!canContinue) {
      setVisible('')
      visibleRef.current = ''
    }
    setTyping(true)
    let index = canContinue ? currentCharacters.length : 0
    const interval = Math.max(18, Math.min(55, Math.floor(800 / text.length)))
    const timer = window.setInterval(() => {
      index += 1
      const next = characters.slice(0, index).join('')
      setVisible(next)
      visibleRef.current = next
      if (index >= characters.length) {
        window.clearInterval(timer)
        setTyping(false)
      }
    }, interval)
    return () => window.clearInterval(timer)
  }, [live, text, textKey])

  if (markdown && !typing) {
    return (
      <div
        className={`${styles.activityMarkdown} ${styles.markdownBody}`}
        aria-live="polite"
        data-agent-process-text
      >
        <MarkdownBlocks source={text} />
      </div>
    )
  }

  return (
    <span
      className={body ? styles.activityRevealBody : styles.activityCopy}
      aria-live="polite"
      data-agent-process-text
      {...(current ? { 'data-agent-process-current': '' } : {})}
    >
      <span aria-hidden="true">
        {visible}
        {typing ? <span className={styles.activityCursor} /> : null}
      </span>
      <span className={styles.srOnly}>{text}</span>
    </span>
  )
}

export function AgentActivityStrip({
  status,
  items,
  activities,
  history,
  processText,
  startedAt,
  finishedAt,
  live,
  revealing = false,
}: {
  status: AgentPanelStatus
  items: readonly ConversationItem[]
  activities: readonly AgentLoopActivity[]
  history: readonly ConversationProcessEntry[]
  processText: string
  startedAt?: number
  finishedAt?: number
  live: boolean
  /** 最终消息仍在逐字 reveal：让刚到达的整块过程也继续逐字展开。 */
  revealing?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [generationPhraseIndex, setGenerationPhraseIndex] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const busy = live && statusIsBusy(status)
  const reasoningHistory = history.filter((entry) => entry.source !== 'intent')
  const intent =
    history.find((entry) => entry.source === 'intent') ??
    (history[0]?.source ? undefined : history[0])
  const liveDetail = [...activities]
    .reverse()
    .find(
      (activity) =>
        activity.status === 'running' && activity.detail?.trim(),
    )?.detail?.trim()
  const latestHistory = reasoningHistory.at(-1) ?? history.at(-1)
  const processHistory = reasoningHistory
  const expandedProcess = expandedProcessView(
    processHistory,
    processText,
  )
  const canExpand = Boolean(processText.trim()) || processHistory.length > 0
  const generationTool = status.kind === 'executing' ? status.tool : undefined

  useEffect(() => {
    setNow(Date.now())
    if (!live || !startedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [live, startedAt])

  useEffect(() => {
    if (
      !live ||
      status.kind !== 'executing' ||
      (generationTool !== 'runNode' && generationTool !== 'runFrom')
    ) {
      setGenerationPhraseIndex(0)
      return
    }
    const timer = window.setInterval(() => {
      setGenerationPhraseIndex((current) => current + 1)
    }, 4_000)
    return () => window.clearInterval(timer)
  }, [generationTool, live, status.kind])

  const currentText = activityTextOf(
    status,
    generationPhraseIndex,
    items,
    activities,
  )
  const isGeneration =
    live && status.kind === 'executing' &&
    (status.tool === 'runNode' || status.tool === 'runFrom')
  const visibleText = !live
    ? latestProcessLine(processText || latestHistory?.text || '')
    : isGeneration
      ? currentText
      : latestProcessLine(processText) || liveDetail || latestProcessLine(latestHistory?.text || '') || currentText
  const animateCurrent = live || revealing
  const elapsedEnd =
    live
      ? now
      : finishedAt ?? history.at(-1)?.createdAt
  const elapsedText =
    startedAt && elapsedEnd && elapsedEnd >= startedAt
      ? formatAgentRunElapsed((elapsedEnd - startedAt) / 1_000)
      : ''
  const showCurrentLine = Boolean(visibleText && visibleText !== intent?.text)

  return (
    <section
      className={expanded ? `${styles.activity} ${styles.activityOpen}` : styles.activity}
      data-agent-activity
      data-agent-activity-expanded={expanded ? 'true' : 'false'}
      data-agent-activity-running={busy ? 'true' : 'false'}
      data-agent-status={status.kind}
      data-agent-process-history={history.length}
    >
      {elapsedText ? (
        <div className={styles.activityDuration} data-agent-process-duration>
          已处理 {elapsedText}
        </div>
      ) : null}
      {intent ? (
        <div className={styles.activityIntent} data-agent-process-intent>
          <TypewriterActivity
            text={intent.text}
            live={live}
            textKey={intent.id}
            markdown
          />
        </div>
      ) : null}
      {showCurrentLine || canExpand ? (
        <div className={styles.activityHead}>
          {showCurrentLine ? (
            <TypewriterActivity
              text={visibleText}
              live={animateCurrent}
              textKey={latestHistory?.id ?? `${status.kind}-${generationPhraseIndex}`}
              current
            />
          ) : (
            <span className={styles.activityCopy} />
          )}
          {canExpand ? (
            <button
              type="button"
              className={styles.activityToggle}
              data-agent-activity-toggle
              aria-expanded={expanded}
              aria-label={expanded ? '收起较早步骤' : '展开全部执行步骤'}
              title={expanded ? '收起较早步骤' : '展开全部执行步骤'}
              onClick={() => setExpanded((current) => !current)}
            >
              <span className={styles.activityToggleIcon}>
                <IconChevronDown size={14} />
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
      {expanded && canExpand ? (
        <div className={styles.activityList} data-agent-activity-list>
          {expandedProcess.liveText ? (
            <div className={styles.activityProcessBody} data-agent-process-live-body>
              <TypewriterActivity
                text={expandedProcess.liveText}
                live={live || revealing}
                textKey={`live-body-${latestHistory?.id ?? status.kind}`}
                markdown
                body
              />
            </div>
          ) : null}
          {expandedProcess.rows.map((step, index) => {
            const revealStep =
              revealing &&
              index === expandedProcess.rows.length - 1 &&
              !expandedProcess.liveText
            return (
            <div
              key={step.id}
              className={styles.activityRow}
              data-agent-process-row={step.id}
            >
              <div className={styles.activityStepName}>
                {revealStep ? (
                  <TypewriterActivity
                    text={step.text}
                    live
                    textKey={`reveal-${step.id}`}
                    markdown
                    body
                  />
                ) : (
                  <MarkdownBlocks source={step.text} />
                )}
              </div>
              {step.createdAt ? (
                <time
                  className={styles.activityStepTime}
                  dateTime={new Date(step.createdAt).toISOString()}
                >
                  {messageTimeText(step.createdAt)}
                </time>
              ) : null}
            </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

/** 步骤卡里嵌的一张小图：直接用画布那套「按 hash 取素材」的钩子，不另写一条取图链路 */
export function StepThumb({ hash }: { hash: string }) {
  const url = useAsset(hash)
  const store = useCanvasStore()
  if (!url) return <span className={styles.thumbEmpty} />
  return (
    <button
      type="button"
      className={styles.thumbButton}
      onClick={() => store.openLightbox(hash)}
      title="放大查看这张图"
      aria-label="放大查看这张图"
      data-agent-thumb-open={hash}
    >
      <img className={styles.thumbImg} src={url} alt="这一步的产物" />
    </button>
  )
}

/** 素材库里的一个缩略图：同样走 `useAsset`，不另写一条取图链路 */
export function LibraryThumb({ hash }: { hash: string }) {
  const url = useAsset(hash)
  if (!url) return <span className={styles.libraryPlaceholder} />
  return <img className={styles.libraryImg} src={url} alt="" />
}

export function messageTimeText(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

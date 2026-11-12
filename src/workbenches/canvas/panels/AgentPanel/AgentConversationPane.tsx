import { useMemo, type RefObject } from 'react'
import type { ResearchGallerySelection } from './ResearchGalleryOverlay'
import {
  researchSelectionActions,
  researchSelectionKey,
  useResearchSelection,
} from './researchSelection'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentLoopActivity } from '../../agent/agentLoop'
import {
  IconCheck,
  IconChevronDown,
  IconCopyText,
  IconLoop,
} from '../../toolbar/icons'
import { MarkdownBlocks } from '../../text/MarkdownBlocks'
import {
  AgentActivityStrip,
  AgentGenerationTasks,
  STATUS_LABEL,
  StepThumb,
  activityTextOf,
  messageTimeText,
  statusIsBusy,
  type AgentPanelStatus,
} from './AgentActivityViews'
import type { AgentConfirmationPreview } from './agentConfirmationPreview'
import {
  formatAgentRunElapsed,
  type AgentRunTask,
} from './agentRunTasks'
import { latestProcessLine } from './agentProcessText'
import {
  AgentQueuePanel,
  type AgentQueueMenuPosition,
} from './AgentQueuePanel'
import { AgentStepIcon } from './AgentStepIcon'
import {
  pendingQuestionCard,
  processBefore,
  type ConversationResearchItem,
  type ConversationItem,
  type ConversationProcessEntry,
} from './conversation'
import { MentionRichText } from './MentionRichText'
import { QuestionCardForm } from './QuestionCardForm'
import { ResearchResultsPreview } from './ResearchResultsPreview'
import { TaskPlanCard } from './TaskPlanCard'
import baseStyles from './AgentPanel.module.css'
import messageStyles from './AgentConversationMessages.module.css'
import stepStyles from './AgentConversationSteps.module.css'

const styles = { ...baseStyles, ...messageStyles, ...stepStyles }

export interface AgentConversationPaneProps {
  current: AgentSession | null
  status: AgentPanelStatus
  items: readonly ConversationItem[]
  visibleItems: readonly ConversationItem[]
  latestProcessIndex: number
  streamingTextIndex: number
  liveActivities: readonly AgentLoopActivity[]
  liveProcess: string
  runTasks: readonly AgentRunTask[] | undefined
  copiedKey: number | null
  expanded: ReadonlySet<string>
  hashOfNode: ReadonlyMap<string, string>
  thumbOf(id: string): string | null
  currentTurnHasProcess: boolean
  latestUserStartedAt?: number
  pendingPlan: AgentConfirmationPreview | null
  pendingTaskStepId?: string
  advancingTaskPlan: boolean
  scrollRef: RefObject<HTMLDivElement>
  showJumpToLatest: boolean
  queueMenuId: string | null
  queueMenuPosition: AgentQueueMenuPosition | null
  editingQueueId: string | null
  editingQueueTurn: AgentSession['queuedTurns'][number] | null
  editingQueueText: string
  onConversationScroll(): void
  onCopyReply(key: number, text: string): void
  onRetry(): void
  onToggleStep(id: string): void
  onAdvanceToNext(): void
  onContinueTask(): void
  onConfirm(): void
  onCancel(): void
  onJumpToLatest(): void
  onGuideQueuedTurn(turn: AgentSession['queuedTurns'][number]): void
  onRemoveQueued(turnId: string): void
  onQueueMenuIdChange(id: string | null): void
  onQueueMenuPositionChange(position: AgentQueueMenuPosition | null): void
  onBeginQueueEdit(turn: AgentSession['queuedTurns'][number]): void
  onCommitQueueEdit(): void
  onEditingQueueIdChange(id: string | null): void
  onEditingQueueTextChange(value: string): void
  onResumeQueue(): void
  onAddResearchReference?(
    item: ConversationResearchItem,
  ): Promise<{ ok: boolean; message: string }>
  onDownloadResearchImage?(
    item: ConversationResearchItem,
  ): Promise<{ ok: boolean; message: string }>
  /** 问题卡提交：回答整理成一条用户消息发回。 */
  onAnswerQuestionCard?(text: string): void
}

export function AgentConversationPane({
  current,
  status,
  items,
  visibleItems,
  latestProcessIndex,
  streamingTextIndex,
  liveActivities,
  liveProcess,
  runTasks,
  copiedKey,
  expanded,
  hashOfNode,
  thumbOf,
  currentTurnHasProcess,
  latestUserStartedAt,
  pendingPlan,
  pendingTaskStepId,
  advancingTaskPlan,
  scrollRef,
  showJumpToLatest,
  queueMenuId,
  queueMenuPosition,
  editingQueueId,
  editingQueueTurn,
  editingQueueText,
  onConversationScroll,
  onCopyReply,
  onRetry,
  onToggleStep,
  onAdvanceToNext,
  onContinueTask,
  onConfirm,
  onCancel,
  onJumpToLatest,
  onGuideQueuedTurn,
  onRemoveQueued,
  onQueueMenuIdChange,
  onQueueMenuPositionChange,
  onBeginQueueEdit,
  onCommitQueueEdit,
  onEditingQueueIdChange,
  onEditingQueueTextChange,
  onResumeQueue,
  onAddResearchReference,
  onDownloadResearchImage,
  onAnswerQuestionCard,
}: AgentConversationPaneProps) {
  const selectionSessionId = current?.id ?? ''
  const selectionState = useResearchSelection(selectionSessionId)
  const researchSelection = useMemo<ResearchGallerySelection>(() => {
    const act = researchSelectionActions(selectionSessionId)
    return {
      selectedKeys: new Set(selectionState.selected.map(researchSelectionKey)),
      sentKeys: selectionState.sentKeys,
      onToggle: act.toggle,
      onStage: act.stage,
    }
  }, [selectionSessionId, selectionState])
  const questionCard = onAnswerQuestionCard ? pendingQuestionCard(visibleItems) : null
  return (
    <div className={styles.contentWrap} data-agent-scroll-wrap>
      {current?.taskPlan && (
        <div className={styles.planDock} data-agent-task-plan-dock>
          <TaskPlanCard
            plan={current.taskPlan}
            pendingConfirmationStepId={pendingTaskStepId}
            advancing={advancingTaskPlan}
            onAdvanceToNext={onAdvanceToNext}
            currentActivity={
              statusIsBusy(status) && current.taskPlan.currentStepId
                ? {
                    running: true,
                    text:
                      latestProcessLine(liveProcess) ||
                      activityTextOf(status, 0, items, liveActivities),
                  }
                : undefined
            }
          />
        </div>
      )}
      <div
        className={styles.content}
        ref={scrollRef}
        data-agent-content
        onScroll={onConversationScroll}
      >
        <div className={styles.messages} data-agent-messages>
          {visibleItems.length === 0 && (
            <p className={styles.hint}>
              说一句你想要什么，我会把它建成画布上的工作流。
            </p>
          )}
          {visibleItems.map((item, index) => {
            if (item.kind === 'user') {
              const copied = copiedKey === index
              return (
                <div
                  key={index}
                  className={`${styles.msgTurn} ${styles.msgTurnUser}`}
                  data-agent-message="user"
                >
                  <div className={styles.msgUser} data-agent-bubble="user">
                    <MentionRichText text={item.text} thumbOf={thumbOf} />
                  </div>
                  <div
                    className={`${styles.msgMeta} ${styles.msgMetaUser}`}
                    data-agent-message-meta="user"
                  >
                    {item.createdAt ? (
                      <time
                        className={styles.msgTime}
                        dateTime={new Date(item.createdAt).toISOString()}
                        title={new Date(item.createdAt).toLocaleString('zh-CN')}
                        data-agent-message-time
                      >
                        {messageTimeText(item.createdAt)}
                      </time>
                    ) : null}
                    <button
                      type="button"
                      className={styles.msgAction}
                      data-agent-user-copy
                      title={copied ? '已复制' : '复制这条消息'}
                      aria-label={copied ? '已复制' : '复制这条消息'}
                      onClick={() => onCopyReply(index, item.text)}
                    >
                      {copied ? <IconCheck size={14} /> : <IconCopyText size={14} />}
                    </button>
                  </div>
                </div>
              )
            }
            if (item.kind === 'process') {
              const live = index === latestProcessIndex && statusIsBusy(status)
              const revealing =
                index === latestProcessIndex && streamingTextIndex >= 0
              return (
                <AgentActivityStrip
                  key={index}
                  status={status}
                  items={items}
                  activities={live ? liveActivities : []}
                  history={item.entries}
                  processText={live ? liveProcess : ''}
                  startedAt={item.startedAt}
                  finishedAt={item.finishedAt}
                  live={live}
                  revealing={revealing}
                />
              )
            }
            if (item.kind === 'text') {
              const copied = copiedKey === index
              const streaming = index === streamingTextIndex
              const currentProcess = processBefore(visibleItems, index)
              const runtimeEnd = currentProcess
                ? Math.max(
                    item.createdAt ?? 0,
                    currentProcess.finishedAt ?? 0,
                    ...currentProcess.entries.map(
                      (entry: ConversationProcessEntry) => entry.createdAt ?? 0,
                    ),
                  ) || undefined
                : item.createdAt
              const runtime =
                !streaming &&
                currentProcess?.startedAt !== undefined &&
                runtimeEnd !== undefined &&
                runtimeEnd >= currentProcess.startedAt
                  ? `已处理 ${formatAgentRunElapsed(
                      (runtimeEnd - currentProcess.startedAt) / 1_000,
                    )}`
                  : ''
              return (
                <div
                  key={index}
                  className={`${styles.msgTurn} ${styles.msgTurnBot}`}
                  data-agent-message="assistant"
                  data-agent-streaming={streaming ? 'true' : undefined}
                >
                  {runtime ? (
                    <div className={styles.msgRuntime} data-agent-message-duration>
                      {runtime}
                    </div>
                  ) : null}
                  <div className={styles.msgBot} data-agent-bubble="assistant">
                    <div className={styles.markdownBody}>
                      <MarkdownBlocks source={item.text} />
                    </div>
                    {streaming && (
                      <span className={styles.streamCaret} aria-hidden="true" />
                    )}
                  </div>
                  <div
                    className={styles.msgMeta}
                    data-agent-message-meta="assistant"
                  >
                    {item.createdAt ? (
                      <time
                        className={styles.msgTime}
                        dateTime={new Date(item.createdAt).toISOString()}
                        title={new Date(item.createdAt).toLocaleString('zh-CN')}
                        data-agent-message-time
                      >
                        {messageTimeText(item.createdAt)}
                      </time>
                    ) : null}
                    {!streaming ? (
                      <div className={styles.msgActions}>
                        <button
                          type="button"
                          className={styles.msgAction}
                          data-agent-copy
                          title={copied ? '已复制' : '复制这条回复'}
                          aria-label={copied ? '已复制' : '复制这条回复'}
                          onClick={() => onCopyReply(index, item.text)}
                        >
                          {copied ? (
                            <IconCheck size={14} />
                          ) : (
                            <IconCopyText size={14} />
                          )}
                        </button>
                        <button
                          type="button"
                          className={styles.msgAction}
                          data-agent-retry
                          title="重新问一遍（重发上一条消息）"
                          aria-label="重新问一遍"
                          onClick={onRetry}
                        >
                          <IconLoop size={14} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            }
            const thumbs = (item.failed ? [] : item.nodeIds)
              .map((id) => ({ id, hash: hashOfNode.get(id) }))
              .filter(
                (thumb): thumb is { id: string; hash: string } =>
                  Boolean(thumb.hash),
              )
            const isOpen = expanded.has(item.id)
            const hasDetail = item.lines.length > 0 || thumbs.length > 0
            return (
              <div
                key={index}
                className={item.failed ? styles.stepFailed : styles.step}
                data-agent-step={item.tool}
                {...(item.failed ? { 'data-agent-step-failed': '' } : {})}
              >
                <button
                  type="button"
                  className={styles.stepHead}
                  data-agent-step-detail={item.tool}
                  onClick={() => hasDetail && onToggleStep(item.id)}
                  title={
                    hasDetail
                      ? isOpen
                        ? '收起细节'
                        : '看这一步的细节'
                      : item.label
                  }
                  aria-expanded={hasDetail ? isOpen : undefined}
                  aria-controls={
                    hasDetail ? `agent-step-detail-${item.id}` : undefined
                  }
                >
                  <span className={styles.stepIcon} aria-hidden="true">
                    <AgentStepIcon tool={item.tool} size={16} />
                  </span>
                  <span className={styles.stepLabel}>{item.label}</span>
                  {hasDetail && (
                    <span className={isOpen ? styles.chevronUp : styles.chevronDown}>
                      <IconChevronDown size={14} />
                    </span>
                  )}
                </button>
                {!isOpen && item.summaryLines && item.summaryLines.length > 0 ? (
                  <div
                    className={styles.stepSummary}
                    data-agent-step-summary={item.tool}
                  >
                    {item.summaryLines.map((line, lineIndex) => (
                      <p key={lineIndex}>{line}</p>
                    ))}
                  </div>
                ) : null}
                {item.tool === 'researchDesign' && item.researchItems?.length ? (
                  <ResearchResultsPreview
                    items={item.researchItems}
                    researchMode={item.researchMode}
                    onAdd={onAddResearchReference}
                    onDownload={onDownloadResearchImage}
                    selection={researchSelection}
                  />
                ) : null}
                {hasDetail ? (
                  <div
                    id={`agent-step-detail-${item.id}`}
                    className={
                      isOpen || item.failed
                        ? `${styles.stepReveal} ${styles.stepRevealOpen}`
                        : styles.stepReveal
                    }
                    data-agent-step-reveal={
                      isOpen || item.failed ? 'open' : 'closed'
                    }
                    aria-hidden={!(isOpen || item.failed)}
                  >
                    <div className={styles.stepRevealInner}>
                      {item.lines.length > 0 ? (
                        <ul className={styles.stepLines}>
                          {item.lines.map((line, lineIndex) => (
                            <li key={lineIndex}>{line}</li>
                          ))}
                        </ul>
                      ) : null}
                      {(isOpen || item.failed) && thumbs.length > 0 ? (
                        <div className={styles.thumbs}>
                          {thumbs.map((thumb) => (
                            <span
                              key={thumb.id}
                              className={styles.thumb}
                              data-agent-thumb={thumb.id}
                            >
                              <StepThumb hash={thumb.hash} />
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        {questionCard && onAnswerQuestionCard ? (
          <QuestionCardForm
            key={questionCard.stepId}
            cardId={questionCard.stepId}
            questions={questionCard.questions}
            disabled={statusIsBusy(status)}
            onSubmit={onAnswerQuestionCard}
          />
        ) : null}

        {runTasks &&
          runTasks.length > 0 &&
          status.kind === 'executing' &&
          (status.tool === 'runNode' || status.tool === 'runFrom') && (
            <AgentGenerationTasks tasks={runTasks} />
          )}

        {(status.kind === 'error' || status.kind === 'paused') && (
          <div
            className={styles.statusLine}
            data-agent-status-line={status.kind}
          >
            {STATUS_LABEL[status.kind]}：{status.message}
          </div>
        )}
        {!currentTurnHasProcess &&
        (status.kind === 'thinking' ||
          status.kind === 'toolRunning' ||
          status.kind === 'executing' ||
          status.kind === 'awaitingConfirm') ? (
          <AgentActivityStrip
            status={status}
            items={items}
            activities={liveActivities}
            history={[]}
            processText={liveProcess}
            startedAt={latestUserStartedAt}
            live
          />
        ) : null}

        {status.kind === 'paused' && current?.continuation && (
          <div className={styles.step} data-agent-continuation>
            <div className={styles.stepHead}>
              <span className={styles.stepLabel}>任务检查点</span>
            </div>
            <p className={styles.continuationText}>
              已完成 {current.continuation.maxSteps} 步，工具结果已保存。继续时从检查点接着执行。
            </p>
            <p className={styles.continuationText} data-agent-context-recovery>
              已保存 {current.messages.length} 条历史 ·{' '}
              {current.messages.filter((message) => message.role === 'user').length} 条用户需求 ·{' '}
              {current.messages.filter((message) => message.role === 'tool').length} 条工具结果
              {current.taskPlan
                ? ` · ${current.taskPlan.steps.length} 个计划步骤`
                : ' · 无任务计划'}
            </p>
            <p className={styles.continuationText} data-agent-context-injection>
              继续时会重建原始需求、任务计划和画布摘要，并附上最近{' '}
              {Math.min(
                4,
                current.messages.filter((message) => message.role === 'tool').length,
              )}{' '}
              条工具账本；完整历史仍按本会话的模型窗口读取。
            </p>
            <div className={styles.row}>
              <button
                type="button"
                className={styles.primary}
                onClick={onContinueTask}
                data-agent-continue
              >
                继续任务
              </button>
            </div>
          </div>
        )}

        {pendingPlan && (
          <div
            className={`${styles.step} ${styles.previewCard}`}
            data-agent-preview={pendingPlan.tool}
          >
            <div className={styles.stepHead}>
              <span className={styles.stepLabel}>{pendingPlan.title}</span>
            </div>
            <ul className={styles.stepLines}>
              {pendingPlan.lines.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
            <div className={styles.row}>
              <button
                type="button"
                className={styles.primary}
                onClick={onConfirm}
                data-agent-confirm
              >
                {pendingPlan.action}
              </button>
              <button
                type="button"
                className={styles.smallBtn}
                onClick={onCancel}
                data-agent-cancel
              >
                取消
              </button>
            </div>
          </div>
        )}

        {current && current.pendingSteers.length > 0 && (
          <div
            className={styles.steerPending}
            data-agent-steer-pending={current.pendingSteers.length}
          >
            <span>{current.pendingSteers.length} 条引导将在下一步生效</span>
          </div>
        )}

        <AgentQueuePanel
          turns={current?.queuedTurns ?? []}
          status={status}
          menuId={queueMenuId}
          menuPosition={queueMenuPosition}
          editingId={editingQueueId}
          editingTurn={editingQueueTurn}
          editingText={editingQueueText}
          onGuide={onGuideQueuedTurn}
          onRemove={onRemoveQueued}
          onMenuIdChange={onQueueMenuIdChange}
          onMenuPositionChange={onQueueMenuPositionChange}
          onBeginEdit={onBeginQueueEdit}
          onCommitEdit={onCommitQueueEdit}
          onEditingIdChange={onEditingQueueIdChange}
          onEditingTextChange={onEditingQueueTextChange}
          onResume={onResumeQueue}
        />
      </div>
      {showJumpToLatest && (
        <button
          type="button"
          className={styles.jumpLatest}
          onClick={onJumpToLatest}
          data-agent-jump-latest
        >
          <IconChevronDown size={14} />
          跳至最新
        </button>
      )}
    </div>
  )
}

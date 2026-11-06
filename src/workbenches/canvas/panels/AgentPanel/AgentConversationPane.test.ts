import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { createAgentSessionStore } from '../../../../state/agent/sessionStore'
import { createMemoryPlatform } from '../../../../platform/memory'
import { AgentConversationPane } from './AgentConversationPane'

const session: AgentSession = {
  id: 'session-1',
  projectId: 'project-1',
  title: '会话一',
  channelId: '',
  model: 'model-1',
  imageModel: 'image-1',
  videoModel: '',
  messages: [],
  pendingSteers: [],
  queuedTurns: [],
  createdAt: 1,
  updatedAt: 1,
}

function renderPane(
  patch: Partial<Parameters<typeof AgentConversationPane>[0]> = {},
): string {
  const callbacks = {
    onConversationScroll: vi.fn(),
    onCopyReply: vi.fn(),
    onRetry: vi.fn(),
    onToggleStep: vi.fn(),
    onAdvanceToNext: vi.fn(),
    onContinueTask: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    onJumpToLatest: vi.fn(),
    onGuideQueuedTurn: vi.fn(),
    onRemoveQueued: vi.fn(),
    onQueueMenuIdChange: vi.fn(),
    onQueueMenuPositionChange: vi.fn(),
    onBeginQueueEdit: vi.fn(),
    onCommitQueueEdit: vi.fn(),
    onEditingQueueIdChange: vi.fn(),
    onEditingQueueTextChange: vi.fn(),
    onResumeQueue: vi.fn(),
  }
  return renderToStaticMarkup(
    createElement(AgentConversationPane, {
      current: session,
      status: { kind: 'idle' },
      items: [],
      visibleItems: [],
      latestProcessIndex: -1,
      streamingTextIndex: -1,
      liveActivities: [],
      liveProcess: '',
      runTasks: undefined,
      copiedKey: null,
      expanded: new Set<string>(),
      hashOfNode: new Map<string, string>(),
      thumbOf: () => null,
      currentTurnHasProcess: false,
      pendingPlan: null,
      advancingTaskPlan: false,
      scrollRef: createRef<HTMLDivElement>(),
      showJumpToLatest: false,
      queueMenuId: null,
      queueMenuPosition: null,
      editingQueueId: null,
      editingQueueTurn: null,
      editingQueueText: '',
      ...callbacks,
      ...patch,
    }),
  )
}

describe('AgentConversationPane', () => {
  it('保留滚动、消息与空态锚点', () => {
    const html = renderPane()

    expect(html).toContain('data-agent-scroll-wrap')
    expect(html).toContain('data-agent-content')
    expect(html).toContain('data-agent-messages')
    expect(html).toContain('说一句你想要什么')
  })

  it('确认卡仍在对话流内，并保留批准与取消语义', () => {
    const html = renderPane({
      status: {
        kind: 'awaitingConfirm',
        request: {
          callId: 'call-1',
          name: 'runNode',
          args: { nodeIds: ['node-1'] },
        },
      },
      pendingPlan: {
        tool: 'runNode',
        title: '是否运行节点「主图」生成图片？',
        lines: ['跑 1 个节点（会花钱）'],
        action: '批准运行',
      },
    })

    expect(html).toContain('data-agent-preview="runNode"')
    expect(html).toContain('data-agent-confirm')
    expect(html).toContain('data-agent-cancel')
    expect(html).toContain('批准运行')
  })

  it('排队信息仍位于输入区之前', () => {
    const html = renderPane({
      current: {
        ...session,
        queuedTurns: [
          {
            id: 'turn-1',
            text: '排在后面',
            createdAt: 2,
            channelId: '',
            model: 'model-1',
          },
        ],
      },
    })

    expect(html).toContain('data-agent-queue')
    expect(html).toContain('排在后面')
    expect(html).toContain('data-agent-scroll-wrap')
  })

  it('检查点明确显示恢复了多少持久历史与工具账本', () => {
    const html = renderPane({
      current: {
        ...session,
        id: 'session-context-1234',
        messages: [
          { role: 'user', content: '做一套品牌图' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call-1', name: 'readGraph', args: '{}' }],
          },
          {
            role: 'tool',
            content: '读取完成',
            toolCallId: 'call-1',
            toolName: 'readGraph',
          },
        ],
        continuation: {
          reason: 'max_steps',
          maxSteps: 12,
          createdAt: 2,
        },
      },
      status: { kind: 'paused', message: '已达到检查点' },
    })

    expect(html).toContain('data-agent-context-recovery')
    expect(html).toContain('已保存 3 条历史')
    expect(html).toContain('1 条用户需求')
    expect(html).toContain('1 条工具结果')
    expect(html).toContain('data-agent-context-injection')
    expect(html).toContain('最近 1 条工具账本')
  })

  it('★★ 真实 store 领取后，活动回合不再渲染成等待队列行', async () => {
    const sessions = createAgentSessionStore(createMemoryPlatform().storage)
    const created = await sessions.create({
      projectId: 'project-1',
      channelId: '',
      model: 'model-1',
    })
    await sessions.enqueueTurn(created.id, {
      id: 'turn-active',
      text: '正在运行的手帕种草图',
      createdAt: 2,
      channelId: '',
      model: 'model-1',
    })
    const claimed = await sessions.claimNextQueuedTurn(created.id)
    expect(claimed?.session).toMatchObject({
      activeTurnId: 'turn-active',
      activeTurn: { id: 'turn-active' },
      queuedTurns: [],
    })

    const html = renderPane({
      current: claimed!.session,
      status: { kind: 'thinking' },
    })
    expect(html).not.toContain('data-agent-queue')
    expect(html).not.toContain('正在运行的手帕种草图')
  })
})

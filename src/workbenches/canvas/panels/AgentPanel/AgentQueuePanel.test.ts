import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { QueuedAgentTurn } from '../../../../domain/agent/queuedTurn'
import { AgentQueuePanel } from './AgentQueuePanel'

const turn: QueuedAgentTurn = {
  id: 'turn-1',
  text: '@[主图](node:node-1) 生成主图',
  createdAt: 1,
  channelId: 'c1',
  model: 'm1',
}

function renderQueue(
  patch: Partial<Parameters<typeof AgentQueuePanel>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(AgentQueuePanel, {
      turns: [turn],
      status: { kind: 'idle' },
      menuId: null,
      menuPosition: null,
      editingId: null,
      editingTurn: null,
      editingText: '',
      onGuide: vi.fn(),
      onRemove: vi.fn(),
      onMenuIdChange: vi.fn(),
      onMenuPositionChange: vi.fn(),
      onBeginEdit: vi.fn(),
      onCommitEdit: vi.fn(),
      onEditingIdChange: vi.fn(),
      onEditingTextChange: vi.fn(),
      onResume: vi.fn(),
      ...patch,
    }),
  )
}

describe('AgentQueuePanel', () => {
  it('保留排队区的 DOM 锚点、按钮语义与纯文本预览', () => {
    const html = renderQueue()

    expect(html).toContain('data-agent-queue')
    expect(html).toContain('data-agent-queue-count="1"')
    expect(html).toContain('data-agent-queue-item="turn-1"')
    expect(html).toContain('data-agent-queue-steer')
    expect(html).toContain('data-agent-queue-remove')
    expect(html).toContain('data-agent-queue-more="turn-1"')
    expect(html).toContain('data-agent-queue-resume')
    expect(html).toContain('aria-label="直接引导"')
    expect(html).toContain('aria-label="删除消息"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('生成主图')
    expect(html).not.toContain('(node:node-1)')
    expect(html).toContain('继续排队')
  })

  it('运行时隐藏继续排队，编辑态保留输入与保存/取消', () => {
    const html = renderQueue({
      status: { kind: 'thinking' },
      editingId: turn.id,
      editingTurn: turn,
      editingText: '改过的消息',
    })

    expect(html).not.toContain('data-agent-queue-resume')
    expect(html).toContain('data-agent-queue-edit-input')
    expect(html).toContain('data-agent-queue-edit-save')
    expect(html).toContain('aria-label="编辑排队消息"')
    expect(html).toContain('改过的消息')
    expect(html).toContain('保存')
    expect(html).toContain('取消')
  })

  it('没有排队项时不渲染空容器', () => {
    expect(renderQueue({ turns: [] })).toBe('')
  })
})

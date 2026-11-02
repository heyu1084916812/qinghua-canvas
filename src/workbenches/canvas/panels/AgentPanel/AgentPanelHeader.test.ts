import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { AgentPanelHeader } from './AgentPanelHeader'

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

function renderHeader(
  patch: Partial<Parameters<typeof AgentPanelHeader>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(AgentPanelHeader, {
      sessions: [session],
      current: session,
      renaming: false,
      titleDraft: '',
      pickerOpen: false,
      confirmDelete: false,
      onTitleDraftChange: vi.fn(),
      onCommitRename: vi.fn(),
      onCancelRename: vi.fn(),
      onToggleSessionPicker: vi.fn(),
      onClosePicker: vi.fn(),
      onSwitchSession: vi.fn(),
      onNewSession: vi.fn(),
      onStartRename: vi.fn(),
      onDeleteSession: vi.fn(),
      onOpenSettings: vi.fn(),
      onClose: vi.fn(),
      ...patch,
    }),
  )
}

describe('AgentPanelHeader', () => {
  it('保留会话与生命周期按钮的 DOM 锚点和顺序', () => {
    const html = renderHeader()
    const anchors = [
      'data-agent-session-count="1"',
      'data-agent-new',
      'data-agent-rename',
      'data-agent-delete',
      'data-agent-settings',
      'data-agent-close',
    ]

    let previous = -1
    for (const anchor of anchors) {
      const current = html.indexOf(anchor)
      expect(current).toBeGreaterThan(previous)
      previous = current
    }
    expect(html).toContain('会话一')
  })

  it('改名态只保留输入、保存和取消', () => {
    const html = renderHeader({
      renaming: true,
      titleDraft: '新名字',
    })

    expect(html).toContain('data-agent-title-input')
    expect(html).toContain('data-agent-rename-save')
    expect(html).toContain('data-agent-rename-cancel')
    expect(html).not.toContain('data-agent-new')
    expect(html).not.toContain('data-agent-settings')
  })

  it('准备删除时显示二次确认文案', () => {
    const html = renderHeader({ confirmDelete: true })

    expect(html).toContain('确认删除')
    expect(html).toContain('再点一次就删掉')
  })
})

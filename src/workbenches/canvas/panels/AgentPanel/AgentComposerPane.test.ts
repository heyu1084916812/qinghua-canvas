import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { MentionEditorHandle } from '../../text/MentionEditor'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { AgentComposerPane } from './AgentComposerPane'

const session: AgentSession = {
  id: 'session-1',
  projectId: 'project-1',
  title: '会话一',
  channelId: '',
  model: 'GPT-6 Astra',
  imageModel: 'GPT Image 2',
  videoModel: '',
  messages: [],
  pendingSteers: [],
  queuedTurns: [],
  createdAt: 1,
  updatedAt: 1,
}

function renderComposer(
  patch: Partial<Parameters<typeof AgentComposerPane>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(AgentComposerPane, {
      current: session,
      status: { kind: 'idle' },
      deliveryMode: 'steer',
      draft: '',
      composerHeight: 180,
      composerResizing: false,
      openPicker: null,
      shownModel: 'GPT-6 Astra',
      chatModelOptions: ['GPT-6 Astra'],
      modelOptionsByKind: {
        image: ['GPT Image 2'],
        video: ['视频模型'],
      },
      globalImageModels: ['GPT Image 2'],
      globalVideoModels: ['视频模型'],
      mentionedModels: new Set<string>(),
      graph: {
        nodes: [{ id: 'node-1', title: '主图', type: 'generation' }],
      },
      libraryAssets: [],
      allSkills: [],
      skillLabel: '技能',
      skillFavs: [],
      skills: { builtinSkills: [], userSkills: [] },
      thumbVersion: 0,
      editorRef: { current: null as MentionEditorHandle | null },
      composerRef: { current: null },
      fileRef: { current: null },
      skillFileRef: { current: null },
      skillDirRef: { current: null },
      composerAvailableHeight: () => 700,
      beginComposerResize: vi.fn(),
      resizeComposerWithKeyboard: vi.fn(),
      replaceDraft: vi.fn(),
      send: vi.fn(),
      stop: vi.fn(),
      attachFiles: vi.fn(),
      addFromLibrary: vi.fn(),
      pickModel: vi.fn(),
      setModelKind: vi.fn(),
      setSkill: vi.fn(),
      toggleSkillFavorite: vi.fn(),
      openSkillLibrary: vi.fn(),
      importSkills: vi.fn(),
      patchSession: vi.fn(),
      setAutoRun: vi.fn(),
      insertMention: vi.fn(),
      setDraft: vi.fn(),
      setOpenPicker: vi.fn(),
      thumbOf: () => null,
      channels: { globalModelOf: () => undefined },
      library: { load: async () => undefined },
      ...patch,
    }),
  )
}

describe('AgentComposerPane', () => {
  it('保留输入区、工具条、文件入口和高度锚点', () => {
    const html = renderComposer()

    expect(html).toContain('data-agent-llm-row')
    expect(html).toContain('data-agent-composer')
    expect(html).toContain('data-agent-composer-height="180"')
    expect(html).toContain('data-agent-composer-resize')
    expect(html).toContain('data-agent-input')
    expect(html).toContain('data-agent-add-asset')
    expect(html).toContain('data-param-chip="agent-mention"')
    expect(html).toContain('data-agent-skill-open')
    expect(html).toContain('data-agent-send-idle')
    expect(html).toContain('data-agent-file')
  })

  it('有草稿时显示发送，运行中显示停止', () => {
    const html = renderComposer({
      draft: '生成主图',
      status: { kind: 'thinking' },
    })

    expect(html).toContain('data-agent-send')
    expect(html).toContain('data-agent-stop')
    expect(html).not.toContain('data-agent-send-idle')
  })

  it('投递模式与自动生成状态由会话字段呈现', () => {
    const html = renderComposer({
      deliveryMode: 'queue',
      current: { ...session, autoRun: true, contextWindow: 20 },
    })

    expect(html).toContain('data-agent-delivery-mode="queue"')
    expect(html).toContain('回读 20 条')
    expect(html).toContain('自动生成：计划需你确认，之后自动执行')

    const expanded = renderComposer({
      current: { ...session, autoRun: true },
      openPicker: 'agent-autorun',
    })
    expect(expanded).toContain('计划需你确认，之后自动执行并扣费')
    expect(expanded).not.toContain('自动确认计划并直接消耗积分')
  })
})

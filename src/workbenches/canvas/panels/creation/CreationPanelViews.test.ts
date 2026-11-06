import { createElement, type MutableRefObject } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MentionEditorHandle } from '../../text/MentionEditor'
import type { PanelModel } from '../panelModel'
import { CreationAssetsView } from './CreationAssetsView'
import { CreationParameterControls } from './CreationParameterControls'
import { CreationPromptView } from './CreationPromptView'
import { CreationRunActionsView } from './CreationRunActionsView'
import type { deriveCreationQualityParams } from './creationQualityParams'

const model: PanelModel = {
  thumbs: [],
  collections: [],
  emptyHint: '连线上游节点，或拖入素材',
  prompt: '',
  linkedPromptCount: 0,
  promptToggle: null,
  selectedSkillId: null,
  mentionCandidates: [],
  preset: null,
  presetOptions: {},
  emotion: null,
}

describe('CreationPanel 视图拆分', () => {
  it('素材视图直接返回原 section，并保持图片/视频按钮顺序', () => {
    const html = renderToStaticMarkup(
      createElement(CreationAssetsView, {
        assetsEmpty: true,
        emptyHint: model.emptyHint,
        collections: [],
        thumbs: [],
        dragIndex: null,
        mode: 'image',
        showCategoryToggle: true,
        onDragStart: () => {},
        onDrop: () => {},
        onToggleCollection: () => {},
        onToggleThumb: () => {},
        onRemoveThumb: () => {},
        onModeChange: () => {},
      }),
    )

    expect(html).toMatch(/^<section /)
    expect(html).toContain('data-panel-part="assets"')
    expect(html).toContain('data-panel-asset-empty')
    expect(html).toContain('data-param-mode="image"')
    expect(html).toContain('data-param-mode="video"')
    expect(html.indexOf('data-param-mode="image"')).toBeLessThan(
      html.indexOf('data-param-mode="video"'),
    )
  })

  it('提示词视图保留编辑器锚点、字数和原始 section 层级', () => {
    const promptBoxRef: MutableRefObject<HTMLDivElement | null> = { current: null }
    const promptEditorRef: MutableRefObject<MentionEditorHandle | null> = {
      current: null,
    }
    const html = renderToStaticMarkup(
      createElement(CreationPromptView, {
        promptExpanded: false,
        promptOverflow: false,
        linkedPromptCount: 0,
        promptBoxRef,
        promptEditorRef,
        promptValue: '',
        label: '提示词节点正文',
        placeholder: '输入提示词',
        mentionOpen: false,
        mentionPos: null,
        mentionCandidates: [],
        mentionHashOf: new Map(),
        mentionThumbRef: { current: new Map() },
        mentionThumbVersion: 0,
        mentionThumbOf: () => null,
        promptToggle: null,
        promptMode: true,
        promptLength: 0,
        toolError: null,
        onToggleExpand: () => {},
        onPromptValueChange: () => {},
        onMentionTrigger: () => {},
        onChipClick: () => {},
        onPromptBlur: () => {},
        onInsertMention: () => {},
        onMentionThumbLoaded: () => {},
        onTogglePrompt: () => {},
      }),
    )

    expect(html).toMatch(/^<section /)
    expect(html).toContain('data-panel-part="prompt"')
    expect(html).toContain('data-panel-prompt-box')
    expect(html).toContain('data-panel-prompt=""')
    expect(html).toContain('role="textbox"')
    expect(html).toContain('data-panel-prompt-count')
    expect(html).toContain('0 字')
  })

  it('参数控件不增加包裹层，模型 chip 位于参数 section 首位', () => {
    const quality = {
      videoModeValue: 'text',
      videoModeOptions: [],
      ratios: [],
      shownRatio: '',
      count: 1,
      countChoices: [1],
      maxCount: 1,
      paramsLabel: '',
      sizeChoices: [],
      sizeValue: '',
      sizeLabel: '',
      minSec: 0,
      maxSec: 0,
      duration: 0,
      showDuration: false,
      showVideoMode: false,
      videoCounts: [1],
      videoCount: 1,
      showVideoCount: false,
      showGenerateAudio: false,
      generateAudio: false,
    } as unknown as ReturnType<typeof deriveCreationQualityParams>
    const html = renderToStaticMarkup(
      createElement(
        'section',
        { 'data-panel-part': 'params' },
        createElement(CreationParameterControls, {
          noPlatform: false,
          platformGap: '',
          categoryLabel: '文本模型',
          modelLabel: 'Agnes 2.5 Flash',
          modelOptions: [],
          modelValue: '',
          modelOpen: false,
          videoModeLabel: '',
          promptMode: true,
          videoMode: false,
          quality,
          paramSections: [],
          isMj: false,
          mjSections: [],
          openPicker: null,
          onOpenSettings: () => {},
          onTogglePicker: () => {},
          onClosePicker: () => {},
          onSelectModel: () => {},
          onSelectVideoMode: () => {},
          onSelectRatio: () => {},
          onSelectSize: () => {},
          onDurationChange: () => {},
          onSelectGenerateAudio: () => {},
          onSelectCount: () => {},
        }),
      ),
    )

    expect(html).toMatch(/^<section data-panel-part="params"><span /)
    expect(html.indexOf('data-param-chip="model"')).toBeGreaterThan(-1)
    expect(html).not.toContain('data-param-chip="gen-params"')
  })

  it('运行动作直接输出原按钮，预设关闭时不新增 DOM', () => {
    const html = renderToStaticMarkup(
      createElement(CreationRunActionsView, {
        promptMode: true,
        activePreset: undefined,
        presetOptionsAvailable: false,
        presetOpen: false,
        presetOptionsOpen: false,
        model,
        emotionOn: false,
        running: false,
        busyGlobal: false,
        runDisabled: false,
        runLabel: '生成下游节点',
        runTitle: '生成下游节点',
        blockedReason: null,
        disabled: false,
        error: null,
        onTogglePreset: () => {},
        onPickPreset: () => {},
        onPickEmotion: () => {},
        onPickPresetOption: () => {},
        onRunAction: () => {},
      }),
    )

    expect(html).toMatch(/^<button /)
    expect(html).toContain('data-panel-run')
    expect(html).toContain('aria-label="生成下游节点"')
    expect(html).not.toContain('data-panel-preset')
  })
})

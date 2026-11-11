import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generationSpec } from '../../../../domain/canvas/nodeSpecs/generation'
import { mentionToken } from '../../text/MentionEditor'
import type { RecipeSnapshot } from '../panelModel'
import {
  applyPromptValueChange,
  buildRecipeSnapshot,
  creationModelSelectionEvent,
  creationParamSections,
  createPromptCommitScheduler,
  insertMentionAction,
  mentionPointerAction,
  mjParamSections,
  mjSliderEvent,
  modelBelongsToCategory,
  openMentionAtCaretAction,
  presetPointerAction,
  runPromptToolAction,
} from './creationPromptCoordinator'

describe('creationPromptCoordinator · 提示词提交', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('300ms 防抖只提交最后一次，替换计时器会清掉前一次', () => {
    const commit = vi.fn()
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const scheduler = createPromptCommitScheduler(commit)

    scheduler.schedule('first')
    const first = scheduler.current
    scheduler.schedule('last')

    expect(first).not.toBeNull()
    expect(clear).toHaveBeenCalledWith(first)
    vi.advanceTimersByTime(299)
    expect(commit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(commit).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledWith('last')
    expect(scheduler.current).toBeNull()
  })

  it('取消会清掉待提交计时器，绝不补发旧正文', () => {
    const commit = vi.fn()
    const scheduler = createPromptCommitScheduler(commit)

    scheduler.schedule('drop me')
    scheduler.cancel()
    vi.advanceTimersByTime(300)

    expect(commit).not.toHaveBeenCalled()
    expect(scheduler.current).toBeNull()
  })

  it('预设只在引用值变化时发一次正确事件，正文仍只排期一次', () => {
    const setPreset = vi.fn()
    const schedulePrompt = vi.fn()

    applyPromptValueChange(
      `${mentionToken('preset', 'cinematic', '电影感')}一只猫`,
      {
        currentPreset: 'cinematic',
        presetIdOf: () => 'cinematic',
        plainTextOf: () => '一只猫',
        setPreset,
        schedulePrompt,
      },
    )
    expect(setPreset).not.toHaveBeenCalled()
    expect(schedulePrompt).toHaveBeenCalledOnce()

    applyPromptValueChange('一只猫', {
      currentPreset: 'cinematic',
      presetIdOf: () => null,
      plainTextOf: () => '一只猫',
      setPreset,
      schedulePrompt,
    })
    expect(setPreset).toHaveBeenCalledOnce()
    expect(setPreset).toHaveBeenCalledWith(null)
    expect(schedulePrompt).toHaveBeenCalledTimes(2)
  })
})

describe('creationPromptCoordinator · 引用与菜单', () => {
  it('插入引用走同一 token 形态，并同时关闭候选菜单', () => {
    const insert = vi.fn()
    const closeMention = vi.fn()
    insertMentionAction(
      { id: 'node-7', label: '素材图' },
      mentionToken,
      { insert, closeMention },
    )

    expect(insert).toHaveBeenCalledOnce()
    expect(insert).toHaveBeenCalledWith('@[素材图](node:node-7)')
    expect(closeMention).toHaveBeenCalledOnce()
  })

  it('打开 @ 菜单会关闭预设菜单；无候选时不产生任何状态写入', () => {
    const setPosition = vi.fn()
    const closePresetMenus = vi.fn()
    const openMention = vi.fn()

    openMentionAtCaretAction({
      candidateCount: 2,
      boxRect: { left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100 },
      caretRect: { left: 30, top: 40, right: 30, bottom: 56, width: 0, height: 16 },
      setPosition,
      closePresetMenus,
      openMention,
    })

    expect(setPosition).toHaveBeenCalledWith({ left: 20, top: 40 })
    expect(closePresetMenus).toHaveBeenCalledOnce()
    expect(openMention).toHaveBeenCalledOnce()

    vi.clearAllMocks()
    openMentionAtCaretAction({
      candidateCount: 0,
      boxRect: null,
      caretRect: null,
      setPosition,
      closePresetMenus,
      openMention,
    })
    expect(setPosition).not.toHaveBeenCalled()
    expect(closePresetMenus).not.toHaveBeenCalled()
    expect(openMention).not.toHaveBeenCalled()
  })

  it('预设点外判定区分菜单按钮、菜单空白和别处', () => {
    const target = (matched: Set<string>) => ({
      closest: (selector: string) => (matched.has(selector) ? {} : null),
    })

    expect(
      presetPointerAction(target(new Set(['[data-preset-menu] button']))),
    ).toBe('keep')
    expect(
      presetPointerAction(target(new Set(['[data-preset-menu]']))),
    ).toBe('close')
    expect(presetPointerAction(target(new Set()))).toBe('close')
    expect(
      presetPointerAction(target(new Set(['[data-panel-preset]']))),
    ).toBe('keep')
  })

  it('@ 菜单只在候选条目内保持，菜单空白与别处都关闭', () => {
    expect(
      mentionPointerAction({
        closest: (selector) => (selector === '[data-panel-mention]' ? {} : null),
      }),
    ).toBe('keep')
    expect(
      mentionPointerAction({
        closest: (selector) => (selector === '[data-panel-mention] > div' ? {} : null),
      }),
    ).toBe('close')
  })
})

describe('creationPromptCoordinator · 模型与工具', () => {
  it('模型选择在 provider 存在/不存在时分别决定 channelId 与 recipe', () => {
    const recipe: RecipeSnapshot = {
      channelId: 'old',
      model: 'old-model',
      mode: 'image',
      params: {},
    }

    expect(
      creationModelSelectionEvent({
        modelName: 'next-model',
        provider: 'next-channel',
        ownedChannelId: 'old',
        shownChannelId: 'old',
        recipe,
      }),
    ).toEqual({
      type: 'setModel',
      model: 'next-model',
      channelId: 'next-channel',
      recipe: { ...recipe, channelId: 'next-channel', model: 'next-model' },
    })

    expect(
      creationModelSelectionEvent({
        modelName: 'next-model',
        provider: undefined,
        ownedChannelId: 'old',
        shownChannelId: 'shown',
        recipe,
      }),
    ).toEqual({
      type: 'setModel',
      model: 'next-model',
      recipe: { ...recipe, channelId: 'old', model: 'next-model' },
    })
  })

  it('★ A3：切模型时配方记的是**新**模型（buildRecipeSnapshot 尊重 overrides.model）', () => {
    const snapshot = buildRecipeSnapshot({
      data: { mode: 'image' } as never,
      overrides: { model: 'gpt-image-2.5' },
      channelId: 'old-channel',
      model: 'GPT Image 2',
    })
    expect(snapshot.model).toBe('gpt-image-2.5')

    const event = creationModelSelectionEvent({
      modelName: 'gpt-image-2.5',
      provider: 'xssr',
      ownedChannelId: 'old-channel',
      shownChannelId: 'old-channel',
      recipe: snapshot,
    })
    expect(event).toMatchObject({
      type: 'setModel',
      model: 'gpt-image-2.5',
      channelId: 'xssr',
      recipe: { channelId: 'xssr', model: 'gpt-image-2.5' },
    })
  })

  it('改别的参数时，配方仍沿用面板当前显示的模型', () => {
    const snapshot = buildRecipeSnapshot({
      data: { mode: 'image' } as never,
      overrides: { ratio: '3:4' },
      channelId: 'c',
      model: 'shown-model',
    })
    expect(snapshot).toMatchObject({ channelId: 'c', model: 'shown-model' })
    expect(snapshot.params.ratio).toBe('3:4')
  })

  it('prompt tool 只消费 render 快照 target，缺失时保留守卫输入', () => {
    const run = vi.fn()

    runPromptToolAction({
      text: '原提示词',
      action: 'optimize',
      target: { channelId: 'chat-a', model: 'text-model' },
      fallbackModel: 'fallback',
      tools: { run },
    })
    expect(run).toHaveBeenLastCalledWith('原提示词', 'optimize', {
      channelId: 'chat-a',
      model: 'text-model',
    })

    runPromptToolAction({
      text: '原提示词',
      action: 'translate',
      target: null,
      fallbackModel: 'fallback',
      tools: { run },
    })
    expect(run).toHaveBeenLastCalledWith('原提示词', 'translate', {
      channelId: '',
      model: 'fallback',
    })
  })

  it('模型类别判定只认节点自己保存的模型', () => {
    expect(
      modelBelongsToCategory({
        ownedModel: 'owned',
        target: 'video',
        categoryOf: () => 'video',
      }),
    ).toBe(true)
    expect(
      modelBelongsToCategory({
        ownedModel: '',
        target: 'video',
        categoryOf: () => 'video',
      }),
    ).toBe(false)
  })
})

describe('creationPromptCoordinator · MJ 与参数区', () => {
  it('MJ 非有限值完全忽略，合法值发出对应字段事件', () => {
    const recipeFor = vi.fn(() => ({
      channelId: 'ch',
      model: 'mj',
      mode: 'image' as const,
      params: {},
    }))

    expect(
      mjSliderEvent({ key: 'stylize', value: Number.NaN, recipeFor }),
    ).toBeNull()
    expect(
      mjSliderEvent({ key: 'weird', value: Number.POSITIVE_INFINITY, recipeFor }),
    ).toBeNull()
    expect(recipeFor).not.toHaveBeenCalled()

    expect(
      mjSliderEvent({ key: 'chaos', value: 42, recipeFor }),
    ).toEqual({
      type: 'setMjChaos',
      value: 42,
      recipe: {
        channelId: 'ch',
        model: 'mj',
        mode: 'image',
        params: {},
      },
    })
    expect(recipeFor).toHaveBeenCalledWith({ mjChaos: 42 })
  })

  it('自定义画质先切模式再写合法种子，MJ 高级区保持原参数名', () => {
    const calls: string[] = []
    const sections = creationParamSections({
      data: generationSpec.createDefaultData(),
      resolutions: ['1k'],
      canCustomSize: true,
      resolutionPillValue: '1k',
      customResolutionOn: false,
      storedResolution: '',
      qualityChoices: [],
      backgroundChoices: [],
      ratios: ['1:1'],
      shownRatio: '1:1',
      onCustomMode: (on) => calls.push(`mode:${on}`),
      onResolution: (value) => calls.push(`resolution:${value}`),
      onQuality: vi.fn(),
      onBackground: vi.fn(),
      onRatio: vi.fn(),
    })
    sections[0]?.onSelect('自定义')
    expect(calls).toEqual(['mode:true', 'resolution:1024x1024'])

    const mj = mjParamSections({
      enabled: true,
      settings: { stylize: 100, weird: 0, chaos: 0, personalize: '' },
      onPersonalize: vi.fn(),
      onSlider: vi.fn(),
    })
    expect(mj.map((section) => section.name)).toEqual([
      'mj-personalize',
      'mj-stylize',
      'mj-weird',
      'mj-chaos',
    ])
  })
})

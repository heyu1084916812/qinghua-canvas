import type { GenerationData } from '../../../../domain/canvas/model/node'
import {
  MJ_PERSONALIZE_MAX,
  MJ_SLIDERS,
  type MjSettings,
  type MjSliderKey,
} from '../../../../domain/canvas/layout/mjParams'
import type { PromptToolAction } from '../../../../features/shared/promptTools/promptTools'
import type { PromptToolTarget } from '../../../../features/shared/promptTools/usePromptTools'
import { generationParams } from '../../../../domain/canvas/nodeSpecs/params'
import type { ParamSection } from '../ParamPicker'
import type { PanelEvent, RecipeSnapshot } from '../panelModel'
import {
  CUSTOM_SIZE_SEED,
  RESOLUTION_CUSTOM,
  backgroundLabelOf,
  qualityLabelOf,
  resolutionLabelOf,
  resolutionValueOf,
} from './creationCatalog'

const PROMPT_COMMIT_DELAY_MS = 300

export interface PromptCommitScheduler {
  /** 宿主失焦提交需要读取并清零同一份计时器，不能维护第二份真相。 */
  current: ReturnType<typeof setTimeout> | null
  schedule: (text: string) => void
  cancel: () => void
}

export interface PromptCommitTimerPorts {
  setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void
}

/** 提示词草稿只提交最后一次输入；卸载或外部值同步时取消未提交计时器。 */
export function createPromptCommitScheduler(
  commit: (text: string) => void,
  ports: PromptCommitTimerPorts = {},
): PromptCommitScheduler {
  const scheduleTimer = ports.setTimeout ?? setTimeout
  const clearTimer = ports.clearTimeout ?? clearTimeout
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    get current() {
      return timer
    },
    set current(next) {
      timer = next
    },
    schedule(text) {
      if (timer) clearTimer(timer)
      timer = scheduleTimer(() => {
        timer = null
        commit(text)
      }, PROMPT_COMMIT_DELAY_MS)
    },
    cancel() {
      if (!timer) return
      clearTimer(timer)
      timer = null
    },
  }
}

interface ClosestTarget {
  closest(selector: string): unknown
}

export type MenuPointerAction = 'keep' | 'close'

/** @ 菜单只有点在候选条目上才保持打开，菜单内空白也按点外处理。 */
export function mentionPointerAction(target: ClosestTarget | null): MenuPointerAction {
  return target?.closest('[data-panel-mention]') ? 'keep' : 'close'
}

/**
 * 预设菜单的捕获阶段判定：选项按钮与开关按钮交给 click，菜单空白和别处关闭。
 */
export function presetPointerAction(target: ClosestTarget | null): MenuPointerAction {
  if (
    target?.closest('[data-preset-menu] button') ||
    target?.closest('[data-preset-options] button')
  ) {
    return 'keep'
  }
  if (target?.closest('[data-panel-preset]')) return 'keep'
  return 'close'
}

export interface InsertMentionPorts {
  insert: (token: string) => void
  closeMention: () => void
}

/** 在编辑器光标处插入引用，并关闭候选菜单。 */
export function insertMentionAction(
  candidate: { id: string; label: string },
  mentionTokenOf: (kind: 'node', id: string, label: string) => string,
  ports: InsertMentionPorts,
): void {
  ports.insert(mentionTokenOf('node', candidate.id, candidate.label))
  ports.closeMention()
}

interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface OpenMentionPorts {
  candidateCount: number
  boxRect: RectLike | null
  caretRect: RectLike | null
  setPosition: (position: { left: number; top: number } | null) => void
  closePresetMenus: () => void
  openMention: () => void
}

/** 候选菜单跟随光标；量不到非零光标矩形时退回输入框左上角。 */
export function openMentionAtCaretAction(ports: OpenMentionPorts): void {
  if (ports.candidateCount === 0) return
  const box = ports.boxRect
  const rect = ports.caretRect
  ports.setPosition(
    box && rect && (rect.width > 0 || rect.height > 0)
      ? { left: rect.left - box.left, top: rect.bottom - box.top + 4 }
      : null,
  )
  ports.closePresetMenus()
  ports.openMention()
}

export interface PromptValuePorts {
  currentPreset: string | null
  presetIdOf: (value: string) => string | null
  plainTextOf: (value: string) => string
  setPreset: (preset: string | null) => void
  schedulePrompt: (plainText: string) => void
}

/** 编辑器值落地时，预设只有真实变化才发一次事件，正文始终按纯文本排期。 */
export function applyPromptValueChange(next: string, ports: PromptValuePorts): void {
  const preset = ports.presetIdOf(next)
  if (preset !== ports.currentPreset) ports.setPreset(preset)
  ports.schedulePrompt(ports.plainTextOf(next))
}

export interface RecipeSnapshotInput {
  data: GenerationData
  overrides?: Partial<GenerationData>
  channelId: string
  model: string
}

/** 配方以面板当前可见值为准，overrides 表示本次尚未写入节点的目标值。 */
export function buildRecipeSnapshot(input: RecipeSnapshotInput): RecipeSnapshot {
  const merged = { ...input.data, ...input.overrides }
  const mode = merged.mode ?? 'image'
  return {
    channelId: input.channelId,
    model: input.model,
    mode,
    params: { mode, ...generationParams(merged) },
  }
}

export interface ModelSelectionInput {
  modelName: string
  provider: string | undefined
  ownedChannelId: string
  shownChannelId: string
  recipe: RecipeSnapshot
}

/** 模型事件只在 provider 真实存在且不同于节点旧渠道时携带 channelId。 */
export function creationModelSelectionEvent(input: ModelSelectionInput): PanelEvent {
  const nextChannelId = input.provider ?? input.ownedChannelId
  return {
    type: 'setModel',
    model: input.modelName,
    ...(input.provider && input.provider !== input.ownedChannelId
      ? { channelId: input.provider }
      : {}),
    recipe: {
      ...input.recipe,
      channelId: nextChannelId || input.shownChannelId,
    },
  }
}

export interface PromptToolInput {
  text: string
  action: PromptToolAction
  target: PromptToolTarget | null
  fallbackModel: string
  tools: {
    run: (text: string, action: PromptToolAction, target?: PromptToolTarget) => void
  } | null
}

/** prompt tool 只消费宿主 render 时固定的路由快照。 */
export function runPromptToolAction(input: PromptToolInput): void {
  input.tools?.run(input.text, input.action, {
    channelId: input.target?.channelId ?? '',
    model: input.target?.model ?? input.fallbackModel,
  })
}

export interface MjSliderInput {
  key: MjSliderKey
  value: number
  recipeFor: (overrides: Partial<GenerationData>) => RecipeSnapshot
}

/** MJ 非有限值直接忽略；其余事件名必须与节点字段同名。 */
export function mjSliderEvent(input: MjSliderInput): PanelEvent | null {
  if (!Number.isFinite(input.value)) return null
  if (input.key === 'stylize') {
    return {
      type: 'setMjStylize',
      value: input.value,
      recipe: input.recipeFor({ mjStylize: input.value }),
    }
  }
  if (input.key === 'weird') {
    return {
      type: 'setMjWeird',
      value: input.value,
      recipe: input.recipeFor({ mjWeird: input.value }),
    }
  }
  return {
    type: 'setMjChaos',
    value: input.value,
    recipe: input.recipeFor({ mjChaos: input.value }),
  }
}

export interface ModelCategoryInput {
  ownedModel: string
  target: 'image' | 'video'
  categoryOf: (model: string) => string | undefined
}

export function modelBelongsToCategory(input: ModelCategoryInput): boolean {
  return !!input.ownedModel && input.categoryOf(input.ownedModel) === input.target
}

export interface CreationParamSectionsInput {
  data: GenerationData
  resolutions: readonly string[]
  canCustomSize: boolean
  resolutionPillValue: string
  customResolutionOn: boolean
  storedResolution: string
  customSizeHint?: { text: string; tone: 'muted' | 'error' }
  qualityChoices: readonly string[]
  backgroundChoices: readonly string[]
  ratios: readonly string[]
  shownRatio: string
  onCustomMode: (on: boolean) => void
  onResolution: (value: string) => void
  onQuality: (value: string) => void
  onBackground: (value: string) => void
  onRatio: (value: string) => void
}

export function creationParamSections(input: CreationParamSectionsInput): ParamSection[] {
  return [
    ...(input.resolutions.length > 0
      ? [
          {
            name: 'resolution',
            label: '画质',
            variant: 'pill' as const,
            options: [
              ...input.resolutions.map((value) => ({
                value: resolutionValueOf(value),
                label: resolutionLabelOf(value),
              })),
              ...(input.canCustomSize
                ? [{ value: RESOLUTION_CUSTOM, label: RESOLUTION_CUSTOM }]
                : []),
            ],
            value: input.resolutionPillValue,
            onSelect: (value: string) => {
              const custom = value === RESOLUTION_CUSTOM
              input.onCustomMode(custom)
              input.onResolution(custom ? CUSTOM_SIZE_SEED : value)
            },
          },
        ]
      : []),
    ...(input.customResolutionOn
      ? [
          {
            name: 'resolutionCustom',
            label: '',
            variant: 'text' as const,
            options: [],
            value: input.storedResolution,
            placeholder: '宽x高，如 1024x1536',
            hint: input.customSizeHint?.text,
            hintTone: input.customSizeHint?.tone,
            onSelect: input.onResolution,
          },
        ]
      : []),
    ...(input.qualityChoices.length > 0
      ? [
          {
            name: 'quality',
            label: '',
            variant: 'pill' as const,
            options: input.qualityChoices.map((value) => ({
              value,
              label: qualityLabelOf(value),
            })),
            value: input.data.quality ?? 'auto',
            onSelect: input.onQuality,
          },
        ]
      : []),
    ...(input.backgroundChoices.length > 0
      ? [
          {
            name: 'background',
            label: '背景',
            variant: 'pill' as const,
            options: input.backgroundChoices.map((value) => ({
              value,
              label: backgroundLabelOf(value),
            })),
            value: input.data.background ?? 'auto',
            onSelect: input.onBackground,
          },
        ]
      : []),
    ...(input.ratios.length > 0 && !input.customResolutionOn
      ? [
          {
            name: 'ratio',
            label: '比例',
            variant: 'ratioGrid' as const,
            options: input.ratios.map((value) => ({ value, label: value })),
            value: input.shownRatio,
            onSelect: input.onRatio,
          },
        ]
      : []),
  ]
}

export interface MjParamSectionsInput {
  enabled: boolean
  settings: MjSettings
  onPersonalize: (value: string) => void
  onSlider: (key: MjSliderKey, value: number) => void
}

export function mjParamSections(input: MjParamSectionsInput): ParamSection[] {
  if (!input.enabled) return []
  return [
    {
      name: 'mj-personalize',
      label: '个性化风格',
      variant: 'text',
      options: [],
      value: input.settings.personalize,
      placeholder: `填写你的个性化风格代码（--p，最多 ${MJ_PERSONALIZE_MAX} 字）`,
      onSelect: input.onPersonalize,
    },
    ...MJ_SLIDERS.map((spec) => ({
      name: `mj-${spec.key}`,
      label: spec.label,
      variant: 'slider' as const,
      options: [],
      min: spec.min,
      max: spec.max,
      step: 1,
      value: String(input.settings[spec.key]),
      onSelect: (value: string) => input.onSlider(spec.key, Number(value)),
    })),
  ]
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  useState,
} from 'react'
import type { ModelCapability } from '../../../domain/shared/capability'
import type { GenerationData } from '../../../domain/canvas/model/node'
import type { RecipeSnapshot } from './panelModel'
import { moveInOrder } from './panelModel'
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { useSkills } from '../../../app/providers/SkillStoreProvider'
import {
  mentionToken,
  parseMentions,
  stripMentionMarkup,
  type MentionEditorHandle,
} from '../text/MentionEditor'
import { expandMentions, type MentionCandidate } from '../text/mentionValue'
import type { PromptToolAction } from '../../../features/shared/promptTools/promptTools'
import { resolveTextRoute } from '../execution/textRoute'
import type { ParamSection } from './ParamPicker'
import { creationStyles as styles } from './creation/creationStyles'
/** 浮层外壳（与情绪面板共用一份，见那个文件） */
import shell from './PanelShell.module.css'
import {
  VIDEO_MODE_LABELS,
  videoParamsFor,
  type VideoModeId,
} from '../../../domain/canvas/layout/videoParams'
import { mjSettingsOf } from '../../../domain/canvas/layout/mjParams'
import { imageParamsFor } from '../../../domain/canvas/layout/imageParams'
import {
  capabilityOfLogical,
  categoryOfLogical,
  channelIdForLogical,
  toLogicalName,
} from '../../../domain/project/modelCatalog'
import { ModelIcon } from '../../../features/shared/modelIcon/ModelIcon'
import {
  DEFAULT_EMOTION_ID,
  presetById,
} from '../../../domain/canvas/layout/presets'

import { promptNeedsExpand } from './creation/creationCatalog'
import { creationModelNames, creationModelOptions } from './creation/creationModelOptions'
import { deriveCreationQualityParams } from './creation/creationQualityParams'
import { panelGeometryFor } from './creation/creationPanelGeometry'
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
  type PromptCommitScheduler,
} from './creation/creationPromptCoordinator'
import { CreationAssetsView } from './creation/CreationAssetsView'
import { CreationParameterControls } from './creation/CreationParameterControls'
import { CreationPromptToolsView } from './creation/CreationPromptToolsView'
import { CreationPromptView } from './creation/CreationPromptView'
import { CreationRunActionsView } from './creation/CreationRunActionsView'
import type { CreationPanelProps } from './creation/creationPanelTypes'

export type { CreationPanelProps, PanelPromptTools } from './creation/creationPanelTypes'

export {
  COUNT_OPTIONS,
  RATIO_OPTIONS,
  RATIO_FOLLOW_SOURCE,
  RESOLUTION_CUSTOM,
  resolutionsOf,
  ratiosOf,
  withFollowRatio,
  promptNeedsExpand,
} from './creation/creationCatalog'
/**
 * 比例档位：**九档**（§6.8）。
 *
 * 这是「模型没上报 `aspectRatios`」时的兜底集，也是 `openai-images` 协议的默认能力表
 * （多数中转的 `/v1/models` 不报比例，用户就只能看到这一套）——早先只有 1:1 / 3:2 / 2:3
 * 三档，用香蕉这类实际支持到 21:9 的模型时明显不够选。
 *
 * 排序按「方 → 横 → 竖」成对排列，竖版列表里同类相邻，不用在长列表里来回找。
 * 模型**上报了** `aspectRatios` 时仍以模型为准（能力驱动，UI 不写死）。
 */
/**
 * 创作参数面板（产品文档 §6.8 / §6.11 / §6.12）。
 *
 * 三部分（§6.8）：①上游/内部素材缩略图 ②提示词 ③参数与生成。
 * 分组与批量共用本组件（文档要求「与生成节点完全一致」/「结构一致」），
 * 差异通过 PanelModel 注入的缩略图来源体现。
 *
 * 视觉：无投影，1px 描边 + 背景明度区分层次（§3「画布工作区浮层」）；
 * 宽度约 840px、高度自适应；缩放画布时面板尺寸不变（由调用方用 screen 层定位保证）。
 */
export function CreationPanel(props: CreationPanelProps) {
  const { data, model, onEvent } = props
  const nodeId = props.nodeId ?? ''
  const channels = useChannels()
  const enabled = channels.enabledChannels()
  // 订阅「全量渠道」：设置页改完（新增 / 启用）立刻反映到面板——渠道是应用级单例，
  // 不需要重挂页面。`enabled` 是派生值，每次渲染按最新 state 重算。
  const allChannels = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().channels,
    () => channels.getState().channels,
  )
  useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().customModels,
    () => [],
  )
  const uncommonModelIds = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().uncommonModelIds,
    () => [],
  )
  /** 面板形态判定要先于兜底：解析链按它决定模型类别（chat / video / image） */
  const promptMode = props.mode === 'prompt'
  /** 视频是生成节点的功能类别（`data.mode`），参数集与图片模式不同（§6.8） */
  const videoMode = !promptMode && data.mode === 'video'
  /** 仅在节点模型为空时解析并写回默认配方，已有模型绝不覆盖。 */
  const [fallback, setFallback] = useState<{ channelId: string; model: string } | null>(null)
  /** onEvent 每次渲染都会新建，effect 通过 ref 读取最新值。 */
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const ownedChannelId = data.channelId ?? ''
  const ownedModel = data.model ?? ''
  /** 用稳定签名覆盖渠道启用和模型勾选变化。 */
  const channelSignature = enabled
    .map((c) => `${c.id}:${c.models.length}:${c.modelCache?.length ?? 0}`)
    .join('|')
  /** 解析出的配方必须写回节点；只补显示会造成界面与执行数据分叉。 */
  useEffect(() => {
    let cancelled = false
    if (ownedModel) {
      setFallback(null)
      return
    }
    if (enabled.length === 0) {
      setFallback(null)
      return
    }
    const category = promptMode ? 'chat' : videoMode ? 'video' : 'image'
    void channels
      .defaultForNewNode({ channelId: ownedChannelId, model: ownedModel }, category)
      .then((recipe) => {
        if (cancelled || !recipe) return
        setFallback({ channelId: recipe.channelId, model: recipe.model })
        /** setChannel 会清模型，因此随后必须写回配方模型。 */
        if (!ownedChannelId) onEventRef.current({ type: 'setChannel', channelId: recipe.channelId })
        onEventRef.current({ type: 'setModel', model: recipe.model })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [channels, ownedChannelId, ownedModel, promptMode, videoMode, channelSignature])
  /** 有模型无渠道时只补渠道，并保持用户刚选的模型不变。 */
  useEffect(() => {
    if (ownedChannelId || enabled.length === 0) return
    /** 优先选择真能提供该逻辑模型的渠道。 */
    const provider = ownedModel ? channelIdForLogical(enabled, ownedModel) : undefined
    const target = provider ? enabled.find((c) => c.id === provider) : enabled[0]
    if (!target) return
    /** setChannel 会清模型，因此有用户模型时立即写回。 */
    onEventRef.current({ type: 'setChannel', channelId: target.id })
    if (ownedModel) onEventRef.current({ type: 'setModel', model: ownedModel })
    // 依赖口径与上一条兜底一致：用稳定的 `channelSignature` 而不是每次新建的 `enabled`
  }, [ownedChannelId, ownedModel, enabled, channelSignature])
  /** 面板实际展示的渠道 / 模型：节点自身优先，其次解析链兜底 */
  const shownChannelId = ownedChannelId || fallback?.channelId || ''
  const shownModel = ownedModel || fallback?.model || ''
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null)
  const promptExpanded = nodeId !== '' && expandedNodeId === nodeId
  /** 单个 key 保证同一时刻只开一个参数浮层。 */
  const [openPicker, setOpenPicker] = useState<string | null>(null)

  /** 本地草稿停手 300ms 后落库；切节点时用外部 prompt 覆盖草稿。 */
  const [promptDraft, setPromptDraft] = useState(model.prompt)
  const promptCommit = useRef<PromptCommitScheduler | null>(null)
  if (!promptCommit.current) {
    promptCommit.current = createPromptCommitScheduler((text) => {
      onEventRef.current({ type: 'setPrompt', text })
    })
  }
  const promptTimer = promptCommit.current

  /** 自定义尺寸模式按 nodeId 隔离，清空输入时仍保留输入框。 */
  const [customMode, setCustomMode] = useState<{ nodeId: string; on: boolean } | null>(null)
  const customModeOn = customMode?.nodeId === nodeId && customMode.on

  // 外部值变了（切节点 / 撤销 / 别的入口写入）→ 丢弃本地草稿，跟着外部走
  useEffect(() => {
    setPromptDraft(model.prompt)
    promptCommit.current?.cancel()
  }, [model.prompt])

  // 卸载前把未落库的输入补交，避免「刚打完就关面板」丢字
  useEffect(() => {
    return () => promptCommit.current?.cancel()
  }, [])

  const onPromptChange = (text: string) => {
    setPromptDraft(text)
    promptCommit.current?.schedule(text)
  }
  const closePicker = () => setOpenPicker(null)
  const togglePicker = (key: string) => setOpenPicker((cur) => (cur === key ? null : key))
  const tools = promptMode ? (props.promptTools ?? null) : null

  /** 存储只放纯文本；chip 形态、光标落点和缩略图由编辑器层维护。 */
  const promptEditorRef = useRef<MentionEditorHandle | null>(null)
  const [mentionOpen, setMentionOpen] = useState(false)
  /** 菜单跟随光标；量不到光标时退回输入框左上角。 */
  const [mentionPos, setMentionPos] = useState<{ left: number; top: number } | null>(null)
  const promptBoxRef = useRef<HTMLDivElement | null>(null)
  const [promptOverflow, setPromptOverflow] = useState(false)
  const mentionCandidates = model.mentionCandidates

  useLayoutEffect(() => {
    if (promptExpanded) return
    const editor = promptBoxRef.current?.querySelector<HTMLElement>('[data-panel-prompt]')
    if (!editor) return
    const measure = () => {
      const overflowing = promptNeedsExpand(
        editor.scrollHeight,
        editor.clientHeight,
      )
      setPromptOverflow((current) => (current === overflowing ? current : overflowing))
    }
    measure()
    const frame = requestAnimationFrame(measure)
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(editor)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [nodeId, promptDraft, promptExpanded])

  /** 候选节点 → 素材 hash（面板模型已经算过上游缩略图，这里不再扫一遍图） */
  const mentionHashOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of model.thumbs) if (t.assetHash) map.set(t.id, t.assetHash)
    return map
  }, [model.thumbs])

  /**
   * chip 上的缩略图：编辑器是**命令式建的 DOM**、拿不到 hook，所以图由宿主取一次、
   * 缓存成 `节点 id → objectURL`，再用版本号通知编辑器**就地**补进槽位
   * （与对话窗那套同一招，见 `AgentPanel` 里那段说明）。
   */
  const mentionThumbRef = useRef(new Map<string, string>())
  const [mentionThumbVersion, setMentionThumbVersion] = useState(0)
  const mentionThumbOf = useCallback(
    (id: string) => mentionThumbRef.current.get(id) ?? null,
    [],
  )
  /**
   * 点别处收起 @ 菜单。
   *
   * Esc **不在这里处理**：那个键要按「最上面那层」逐层收（菜单 → 参数浮层 → 面板），
   * 而这一层手里没有那个顺序的信息 —— 交给面板自己的 keydown（它知道有没有浮层开着，
   * 也知道怎么标记「这次 Esc 已被消费」）。这里再插一手只会变成两个地方抢同一个键。
   */
  useEffect(() => {
    if (!mentionOpen) return
    const onDown = (e: PointerEvent) => {
      if (mentionPointerAction(e.target as HTMLElement | null) === 'close') {
        setMentionOpen(false)
      }
    }
    /**
     * **捕获阶段**（第三个参数 `true`）——这条不是保险，是必需：
     * 面板里的素材条 / chip 等控件在自己的 `pointerdown` 上 `stopPropagation()`，
     * 冒泡到 window 的那条路上听众收不到 ⇒ 用户点「看着是空白」的地方，菜单一直挂着。
     * 捕获在**往下传的路上**就判，`stopPropagation` 拦不住它。
     * （同一条教训写在 `.workbuddy/memory/INVARIANTS.md`：点外关闭必须挂捕获阶段。）
     */
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [mentionOpen])

  /** 插进正文：走编辑器自己的 `insertMention`（落在光标处、带 chip 的存储形态） */
  const insertMention = (c: MentionCandidate) => {
    insertMentionAction(c, mentionToken, {
      insert: (token) => promptEditorRef.current?.insertMention(token),
      closeMention: () => setMentionOpen(false),
    })
  }

  /**
   * 编辑器文本 → 节点字段。两件事一起做，顺序不能反：
   * ① 正文存**纯文本**（引用还原成 `@名字`、预设那枚不留痕，见 `mentionValue` / `stripMentionMarkup`）；
   * ② **预设跟着 chip 走** —— 用户在正文里删掉那枚 chip，等于取消预设；
   *    点菜单换一条，chip 与 `data.preset` 一起换。这样「界面上看到的」与
   *    「实际发出去的」（`presetPromptSuffix` 拼的那句）永远同源。
   */
  const onPromptValueChange = (next: string) => {
    applyPromptValueChange(next, {
      currentPreset: model.preset ?? null,
      presetIdOf: (value) =>
        parseMentions(value).find((mention) => mention.kind === 'preset')?.id ?? null,
      plainTextOf: stripMentionMarkup,
      setPreset: (preset) => onEvent({ type: 'setPreset', preset }),
      schedulePrompt: onPromptChange,
    })
  }

  /** 打出 `@`（或编辑器报「触发了引用」）时，把候选菜单落到光标下面 */
  const openMentionAtCaret = () => {
    const sel = window.getSelection()
    openMentionAtCaretAction({
      candidateCount: mentionCandidates.length,
      boxRect: promptBoxRef.current?.getBoundingClientRect() ?? null,
      caretRect:
        sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null,
      setPosition: setMentionPos,
      closePresetMenus,
      openMention: () => setMentionOpen(true),
    })
  }

  /**
   * 预设 / 情绪（用户 2026-10-05 第 14 条）。
   *
   * 两个浮层的开关是**面板自己的状态**（与参数菜单同一套「同一时刻只开一个」的思路），
   * 但「选了哪一条」不在本地 —— 那是节点上的 `data.preset` / `data.emotion`，
   * 面板只把它读出来显示。本地再存一份就会出现「面板显示 A、实际发出去 B」。
   */
  const [presetOpen, setPresetOpen] = useState(false)
  const [presetOptionsOpen, setPresetOptionsOpen] = useState(false)
  const activePreset = presetById(model.preset)
  const emotionOn = !!model.emotion
  /**
   * 预设是**正文里的第一枚 chip**（用户 2026-10-05 第 3 条 + 同日追问
   * 「预设还是单独放在最前方的第一排的继续改」）。
   *
   * 之前把它画在输入框上面单独一行 —— 那是「一个横条」，既不是 chip、也占掉一整行。
   * 现在它就是一枚普通的引用 chip（kind = `preset`），跟着正文一起流过编辑器；
   * 「chip 形态 ↔ 纯文本」的转换仍在 `mentionValue.ts` / `MentionEditor` 那两处。
   */
  const presetToken =
    activePreset && !promptMode ? mentionToken('preset', activePreset.id, activePreset.name) : ''
  const promptValue = useMemo(
    () => `${presetToken}${expandMentions(promptDraft, mentionCandidates)}`,
    [presetToken, promptDraft, mentionCandidates],
  )
  const closePresetMenus = () => {
    setPresetOpen(false)
    setPresetOptionsOpen(false)
  }
  /** 点别处收起预设菜单（与 @ 菜单同一套；Esc 交给面板自己逐层收，见下） */
  useEffect(() => {
    if (!presetOpen && !presetOptionsOpen) return
    const onDown = (e: PointerEvent) => {
      if (presetPointerAction(e.target as HTMLElement | null) === 'close') {
        closePresetMenus()
      }
    }
    /**
     * 同上：**捕获阶段**。用户 2026-10-05 第 3 批报的「点其他空白区域不收起」
     * 就是冒泡阶段收不到（素材条 stopPropagation）—— 实测点面板左缘空白会收、
     * 点顶部素材条不收，差别就在这一层。
     */
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [presetOpen, presetOptionsOpen])
  /** 技能库（共享的全局单例，设置页改完这里会立刻反映） */
  const { skills } = useSkills()
  /**
   * 第一部分是否为空（§6.8）。
   *
   * 抽出来是因为首行要按它决定「空态框出不出来」——空态框与「图片 / 视频」
   * 功能类别切换**共用一行**（空态框在左、类别切换在右、二者等高），
   * 而这一行本身在「既不空、又没有类别切换」时整体不该渲染。
   */
  const assetsEmpty = model.thumbs.length === 0 && model.collections.length === 0

  /**
   * 构造「配方快照」：把面板**当前显示**的渠道 / 模型 / 参数打成一包交给宿主。
   *
   * 为什么不在宿主侧从节点 data 现取（用户 2026-09-23 实测）：
   * 节点为空、只有面板兜底显示着渠道与模型时（新建后尚未落库那条路径），
   * 节点上取到的永远是空值，于是「改了参数就记配方」根本记不上——
   * 表现为「改了参数，再新建还是原来的默认值」。
   *
   * 面板是**唯一**知道「用户眼前这套值是什么」的地方，所以由它带出来。
   * `overrides` 是本次正要写入的那一项（例如刚选的 ratio），因为 state 还没更新。
   */
  const recipeSnapshot = (overrides: Partial<GenerationData> = {}): RecipeSnapshot => {
    return buildRecipeSnapshot({
      data,
      overrides,
      channelId: shownChannelId,
      model: shownModel,
    })
  }

  /**
   * 选模型时同步“哪条渠道能提供它”。
   *
   * 用户界面早已去掉渠道选择；节点里遗留的 `channelId` 只是创建时的内部默认值。
   * 若只改 `model` 不改 `channelId`，执行层仍会按模型正确选路，但日志会拿旧渠道
   * 当成“用户选择”，出现“节点选的是 ModelScope，实际发到 Comfly”的假冲突。
   */
  const selectModel = (modelName: string) => {
    const provider = channelIdForLogical(enabled, modelName, ownedChannelId)
    onEvent(
      creationModelSelectionEvent({
        modelName,
        provider,
        ownedChannelId,
        shownChannelId,
        recipe: recipeSnapshot({ model: modelName }),
      }),
    )
  }

  const activeChannel = enabled.find((c) => c.id === shownChannelId)
  /**
   * 该渠道可选的全部模型。
   *
   * **勾选列表为空的渠道，回落到它的 `modelCache`**（2026-09-18 实测踩到）：
   * 「拉取模型」只是把模型拉进缓存，**不等于勾选**——用户还得在设置页的
   * 「选择模型」里勾上并点应用，那次操作才写进 `models`。
   * 于是「我只配了一个渠道、点了拉取、就直接回画布建节点」这条最常见的路径下，
   * `models` 是空的：
   *   - 节点虽然拿到了默认模型（`defaultForNewNode` 会回落到缓存），
   *     但这里的 `activeModel` 找不到它 → chip 显示占位「生图模型」，
   *     看起来就跟没默认一样；
   *   - 面板的模型下拉也是空的，用户连手动选都做不到。
   *
   * 只在**勾选为空**时回落：勾过的渠道仍以勾选为准（§7.4「用户勾选的才是下拉的数据源」），
   * 否则用户特意筛掉的模型又会冒出来。
   */
  const channelModels: ModelCapability[] =
    activeChannel && activeChannel.models.length > 0
      ? activeChannel.models
      : (activeChannel?.modelCache ?? [])
  /**
   * prompt 模式只能选文本 LLM（§6.7「只能选 LLM 模型」）；生成节点按**功能类别**
   * 过滤（图片 / 视频两套模型，§6.8）。都从 `models`（用户勾选的）里取，
   * 不是 `modelCache`（拉回来的全部）——§7.4。
   */
  const wantedCategory = promptMode ? 'chat' : videoMode ? 'video' : 'image'
  const models: ModelCapability[] = channelModels.filter((m) => m.category === wantedCategory)
  /**
 * M7-4：下拉列的是**逻辑名**，不是各站点的上游 ID。
 *
 * 同一个模型在不同站点 ID 不同（`gpt-image-2` / `image-2`），
 * 用户眼里却只有一个模型 —— 下拉就该只出一个名字；
 * 真正发请求时用哪个 ID 由渠道的 `modelMap` 决定（M7-3 已接好）。
 *
 * 零迁移：没有任何映射时逻辑名 = 上游 ID，列表与加此功能前一字不差。
   */
  /**
   * 模型下拉的数据源。
   *
   * **只有用户拍板的前端显示名**（生图一档 / 对话一档 / 视频一档），
   * 渠道拉回来的模型**不进这里** —— 用户 2026-10-08 第四次讲这条口径：
   * 「这个列表本身就是前端展示的模型名称」。以前那条「新站没配映射就把裸名字补进来」
   * 的后门正是他报的「我前端只显示 6 个，他给我显示 8 个」（对账 #371）。
   *
   * 渠道模型不在这儿，但**渠道照样能跑**：选路认两种提供方式 ——
   * 渠道勾选列表里有这个显示名，或它的映射表里有一行（`routeCandidatesFor`）。
   */
  const globalModelIds = useMemo(
    () => channels.globalModelsOf(wantedCategory).map((model) => model.id),
    [channels, wantedCategory],
  )
  const logicalModelNames = useMemo(
    () => creationModelNames({ wantedCategory, uncommonModelIds, globalModelIds }),
    [wantedCategory, uncommonModelIds, globalModelIds],
  )
  const modelOptions = useMemo(
    () =>
      creationModelOptions({
        wantedCategory,
        uncommonModelIds,
        globalModelIds,
        iconFor: (name) => {
          const preset = channels.globalModelOf(name)
          return preset ? <ModelIcon vendor={preset.vendor} /> : undefined
        },
      }),
    [channels, wantedCategory, uncommonModelIds, globalModelIds],
  )
/** 节点上存的模型名 → 逻辑名（老数据迁移）：见 `logicalModelNames` 处的说明 */
  const shownLogicalModel = toLogicalName(allChannels, shownModel)
  /** 工具目标与界面当前显示值同源，过期渠道组合不发给上游。 */
  const promptToolTarget = resolveTextRoute(allChannels, shownChannelId, shownModel)
  const runPromptTool = (action: PromptToolAction) =>
    runPromptToolAction({
      text: model.prompt,
      action,
      target: promptToolTarget,
      fallbackModel: shownLogicalModel,
      tools,
    })
  /** 未选模型时用固定清单第一项作为可执行默认提示。 */
  const defaultModelLabel =
    logicalModelNames[0] ??
    (promptMode ? '文本模型' : videoMode ? '视频模型' : '生图模型')
  /** 能力先按站点模型 ID 查，再按逻辑名归一；顺序反转会让切类别帧丢能力。 */
  const activeModel =
    models.find((m) => m.id === shownModel) ??
    capabilityOfLogical(allChannels, shownLogicalModel, shownChannelId || undefined)
  /** 类别名：写进占位文案与空态提示，让「没模型」这件事说得出是**哪一类**没有 */
  const categoryLabel = promptMode ? '文本模型' : videoMode ? '视频模型' : '生图模型'
  /** 未声明 maxCount 表示不设限；图片参数有规格时只渲染模型真实支持的档位。 */
  const imageSpec =
    !promptMode && !videoMode
      ? imageParamsFor(shownLogicalModel || String(data.model ?? ''))
      : undefined

  /** 视频参数有模型规格时只渲染真实能力，否则退回通用档位。 */
  const videoSpec = videoMode
    ? videoParamsFor(shownLogicalModel || String(data.model ?? ''))
    : undefined

  /** 参数候选由能力表驱动；“跟随素材”只在确有参考图时出现。 */
  const quality = deriveCreationQualityParams({
    data,
    activeModel,
    imageSpec,
    videoSpec,
    hasSourceImage: props.hasSourceImage === true,
    customModeOn,
  })
  const {
    ratios,
    shownRatio,
    resolutions,
    qualityChoices,
    backgroundChoices,
    canCustomSize,
    customResolutionOn,
    resolutionPillValue,
    customSizeHint: customSizeHintValue,
  } = quality
  const storedResolution = String(data.resolution ?? '')

  /**
   * 图片模式的几段，**顺序与分组照用户 2026-10-15 的参考图**：
   *
   * ```
   * 画质   ← 这一组的标题
   *   [1K | 2K | 4K | 自定义]     ← 尺寸（section 名仍是 `resolution`）
   *   [宽x高 输入框]              ← 只在选了「自定义」时出现
   *   低 · 中 · 高                ← 质量（section 名仍是 `quality`，**不再另起标题**）
   * 背景
   *   [默认 | 透明底]
   * 比例
   *   [网格]                      ← 只有真比例；「自适应」「跟随素材」各有各的表达
   * ```
   *
   * 用户原话：「他是把质量也放在画质那里了，就按照参考图的来做」—— 所以**质量并入
   * 画质这一组**，两行共用一个标题；`quality` 的 `label` 因此留空
   * （`ParamPicker` 对空 label 不画标题栏，见那里的说明）。
   * section 名（`resolution` / `quality`）刻意不改：冒烟与单测都按它定位。
   *
   * **每一段只有真的有候选才出现**：Agnes 的图片模型没有 `quality` / `background`，
   * 那两段整块不摆，而不是摆一排点了没反应的格子。
   *
   * ⚠️ **画质 / 比例两排的档位一律由模型能力表决定**（2026-10-16 收口）：
   *   · GPT Image 的画质**逐模型**：`gpt-image-2` 是 **低 / 中 / 高**；
   *     2.5 那两档还有 **超高 / 极致**（官方规范点名，用户：「gpt2.5 官方是有更多的选择」）；
   *   · 比例网格里**不再有自定比例那一格**（用户：「比例也不需要有自定义」）——
   *     画幅交给上面那格「自定义像素」说全，两个口子并存只会互相矛盾；
   *   · 香蕉（Gemini）的比例表里**没有 `auto`**（用户：「比例不需要有 auto，
   *     跟随素材就是 auto 了」）—— 「跟输入图一致」这件事由**跟随素材**表达，
   *     它本来也只在真有上游图时才出现。
   *
   * 「自定义像素」那一格只在 `openai-images` 方言（GPT Image 三档）下出现：
   * 香蕉的 `image_size` 官方只认 512 / 1K / 2K / 4K，摆出来就是点了没用的死格子。
   *
   * ⚠️ **张数不在这里**（用户 2026-10-15：「数量的选择单独设置在参数的右边，
   * 单独做一个面板」）—— 它已从胶囊里搬出、独立成一枚 chip，见 JSX 里那枚 `count`。
   * 张数是每次都要动的量，与「这一次怎么画」的画质 / 比例不是一类。
   */
  const customSizeHint = customSizeHintValue
  const paramSections: ParamSection[] = creationParamSections({
    data,
    resolutions,
    canCustomSize,
    resolutionPillValue,
    customResolutionOn,
    storedResolution,
    customSizeHint,
    qualityChoices,
    backgroundChoices,
    ratios,
    shownRatio,
    onCustomMode: (on) => setCustomMode({ nodeId, on }),
    onResolution: (value) =>
      onEvent({
        type: 'setResolution',
        resolution: value,
        recipe: recipeSnapshot({ resolution: value }),
      }),
    onQuality: (quality) =>
      onEvent({
        type: 'setQuality',
        quality,
        recipe: recipeSnapshot({ quality: quality as NonNullable<GenerationData['quality']> }),
      }),
    onBackground: (background) =>
      onEvent({
        type: 'setBackground',
        background,
        recipe: recipeSnapshot({ background }),
      }),
    onRatio: (ratio) =>
      onEvent({ type: 'setRatio', ratio, recipe: recipeSnapshot({ ratio }) }),
  })

  /**
   * **Midjourney 的「高级设置」**（用户 2026-10-03 图二）。
   *
   * 它独有、而且别家都没有的那几档风格参数（`--stylize` / `--weird` / `--chaos` / `--p`）
   * 不塞进「生成参数」那枚胶囊里，而是**单独一枚 chip 摆在参数行末尾**
   * （用户原话：「把 mj 的自己独有的参数设置面板做一个，放在参数的后面」）——
   * 理由也是清楚的：它们是**风格**，不是「这次出几张、什么比例」那种每次都要动的量。
   */
  const isMj = !promptMode && imageSpec?.dialect === 'midjourney'
  const mj = mjSettingsOf({
    stylize: data.mjStylize,
    weird: data.mjWeird,
    chaos: data.mjChaos,
    personalize: data.mjPersonalize,
  })
  /**
   * 滑杆 → 事件。**事件名必须与节点字段同名**（`setMjStylize` ↔ `mjStylize`）——
   * 配方记忆那条规则是靠「事件名剥掉 set 就是字段名」认出来的（见 `generationPreset`），
   * 名字对不上就会「改了参数、新建节点却没记住」。
   */
  const onMjSlider = (key: 'stylize' | 'weird' | 'chaos', n: number) => {
    const event = mjSliderEvent({ key, value: n, recipeFor: recipeSnapshot })
    if (event) onEvent(event)
  }
  const mjSections: ParamSection[] = mjParamSections({
    enabled: isMj,
    settings: mj,
    onPersonalize: (value) =>
      onEvent({
        type: 'setMjPersonalize',
        value,
        recipe: recipeSnapshot({ mjPersonalize: value }),
      }),
    onSlider: onMjSlider,
  })
  /**
   * 切换功能类别时，**节点自己存的**模型是否属于目标类别；不属于就得清掉
   * （否则会把图片模型发给视频渠道）。
   *
   * 判的是 `data.model` 而**不是** `shownModel`（G46 实测踩到）：
   * `shownModel` 可能来自面板兜底，而兜底是按**当前**类别算的——
   * 拿它判「该不该清」会永远判成「属于」，切类别就清不掉了。
   * 这里问的是「用户存的这个值还要不要」，与「面板暂时显示什么」是两回事。
   */
  /**
 * 用入参 `m`（**目标**类别）判，不看当前渲染状态：本函数是在「切换前」
 * 那次渲染里调用的，此刻 `videoMode` 仍是旧值 —— 按当前类别判会恒为真
 * ⇒ 旧模型永远清不掉（G46 实测踩到）。
   */
  const modelBelongsTo = (target: 'image' | 'video') =>
    modelBelongsToCategory({
      ownedModel,
      target,
      categoryOf: (model) =>
        categoryOfLogical(
          allChannels,
          toLogicalName(allChannels, model),
          ownedChannelId || undefined,
        ),
    })

  /**
   * 全局运行中**不再**禁用本节点的生成按钮（用户报「一个节点生成时其他节点无法生成」）。
   *
   * 并发槽位已经在执行宿主侧打开（多条 plan 各自持有 controller 与适配器表），
   * 界面必须同步放开——否则用户看到按钮灰着，以为功能没修好。
   * `globalRunning` 仍保留给「本节点未参与但全局有运行」的状态展示（如全局转圈），
   * 它不再是**禁用**理由。
   */
  const busyGlobal = false
  const noPlatform = enabled.length === 0
  const geometry = panelGeometryFor({
    data,
    nodeId,
    expandedNodeId,
    promptMode,
    runsDownstream: props.runsDownstream === true,
    running: props.running,
    disabled: props.disabled === true,
    enabledChannelCount: enabled.length,
    allChannelCount: allChannels.length,
  })
  const {
    runLabel,
    blockedReason,
    runDisabled,
    runTitle,
    platformGap,
  } = geometry
  const reorderThumb = (toIndex: number) => {
    if (dragIndex === null) return
    const order = moveInOrder(model.thumbs, dragIndex, toIndex).map((thumb) => thumb.id)
    setDragIndex(null)
    onEvent({ type: 'reorderThumbs', owner: model.thumbs[toIndex].owner, order })
  }
  const changeMode = (mode: 'image' | 'video') => {
    if (data.mode === mode) return
    onEvent({
      type: 'setMode',
      mode,
      keepModel: modelBelongsTo(mode),
      recipe: recipeSnapshot({ mode }),
    })
  }
  const togglePromptExpand = () => {
    setOpenPicker(null)
    setMentionOpen(false)
    closePresetMenus()
    setExpandedNodeId((current) => (current === nodeId ? null : nodeId))
  }
  const onClickPromptChip = (ref: { kind: string; id: string }) => {
    if (ref.kind !== 'preset') return
    setMentionOpen(false)
    if (presetById(ref.id)?.options) {
      setPresetOpen(false)
      setPresetOptionsOpen(true)
    } else {
      setPresetOptionsOpen(false)
      setPresetOpen(true)
    }
  }
  const onPromptBlur = () => {
    if (!promptTimer.current) return
    promptTimer.cancel()
    onEvent({ type: 'setPrompt', text: promptDraft })
  }
  const setDurationSeconds = (raw: string) => {
    const value = Number(raw)
    if (!Number.isFinite(value) || raw.trim() === '') return
    onEvent({
      type: 'setDurationSec',
      sec: value,
      recipe: recipeSnapshot({ durationSec: value }),
    })
  }
  const selectVideoMode = (videoMode: VideoModeId) =>
    onEvent({
      type: 'setVideoMode',
      videoMode,
      recipe: recipeSnapshot({ videoMode }),
    })
  const selectRatio = (ratio: string) =>
    onEvent({ type: 'setRatio', ratio, recipe: recipeSnapshot({ ratio }) })
  const selectSize = (size: string) =>
    onEvent({ type: 'setSize', size, recipe: recipeSnapshot({ size }) })
  const selectGenerateAudio = (value: string) =>
    onEvent({
      type: 'setGenerateAudio',
      generateAudio: value === 'on',
      recipe: recipeSnapshot({ generateAudio: value === 'on' }),
    })
  const selectCount = (value: string) =>
    onEvent({
      type: 'setCount',
      count: Number(value),
      recipe: recipeSnapshot({ count: Number(value) }),
    })
  const togglePreset = () => {
    setMentionOpen(false)
    setPresetOptionsOpen(false)
    setPresetOpen((open) => !open)
  }
  const pickPreset = (preset: string) => {
    setPresetOpen(false)
    onEvent({ type: 'setPreset', preset })
  }
  const pickEmotion = () => {
    closePresetMenus()
    onEvent({ type: 'setEmotion', emotion: model.emotion ?? DEFAULT_EMOTION_ID })
  }
  const pickPresetOption = (group: string, choice: string) =>
    onEvent({ type: 'setPresetOption', group, choice })

  return (
    <div
      className={`${shell.panel} ${promptExpanded ? shell.panelExpanded : shell.panelStandard}`}
      data-creation-panel
      data-panel-expanded={promptExpanded ? 'true' : 'false'}
      data-panel-comfort="fixed"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        // Esc 先关参数浮层，浮层没了才关整个面板——否则想收起一个下拉，
        // 结果把面板也一起关掉了（§6.8「参数面板内 Esc → 关闭当前参数选择面板」）。
        if (openPicker) {
          /**
           * 关浮层的同时必须**声明这次 Esc 已被消费**。
           *
           * 少了这一句会踩一个真实的坑：`NodeFollowBar` 在 **window** 上监听 Esc
           * 并 `setSelection([])`（它得挂 window，否则焦点不在画布上时 Esc 会失灵）。
           * 而 React 的 `onKeyDown` 不会拦住事件继续冒到 window —— 于是一次 Esc
           * 做了两件事：收起下拉 **并且** 清空选中，面板当场消失。
           * 用户看到的就是「想收起下拉，整个面板没了」。
           *
           * 用 `preventDefault()` 而不是 `stopPropagation()`：后者依赖「React 把监听器
           * 挂在哪个节点」这一实现细节（React 17+ 挂在 root container 上），
           * 换挂载点即失效；`defaultPrevented` 是**跨层协商**，谁吃掉谁标记，与传播路径无关。
           */
          e.preventDefault()
          setOpenPicker(null)
        } else if (mentionOpen) {
          /**
           * 再往下才轮到 `@` 候选菜单。
           *
           * 顺序不能反：菜单是**浮在面板上的**一层，Esc 的语义按「最上面那层」来。
           * 这一步也必须 `preventDefault()`（同下）—— 否则一次 Esc 会既收菜单
           * 又关掉整个面板（实测：只点开菜单再按 Esc，面板一起没了）。
           */
          e.preventDefault()
          setMentionOpen(false)
        } else if (presetOpen || presetOptionsOpen) {
          /** 再往下是预设菜单 / 它的二级搭配（同一条「逐层收」的规则，见上） */
          e.preventDefault()
          closePresetMenus()
        } else {
          props.onClose()
        }
      }}
    >
      <CreationAssetsView
        assetsEmpty={assetsEmpty}
        emptyHint={model.emptyHint}
        collections={model.collections}
        thumbs={model.thumbs}
        dragIndex={dragIndex}
        mode={data.mode}
        showCategoryToggle={props.showCategoryToggle}
        onDragStart={setDragIndex}
        onDrop={reorderThumb}
        onToggleCollection={(id) => onEvent({ type: 'toggleCollection', id })}
        onToggleThumb={(owner, id) => onEvent({ type: 'toggleThumb', owner, id })}
        onRemoveThumb={(owner, id) => onEvent({ type: 'removeThumb', owner, id })}
        onModeChange={changeMode}
      />

      <CreationPromptView
        promptExpanded={promptExpanded}
        promptOverflow={promptOverflow}
        linkedPromptCount={model.linkedPromptCount}
        promptBoxRef={promptBoxRef}
        promptEditorRef={promptEditorRef}
        promptValue={promptValue}
        label={promptMode ? '提示词节点正文' : '生成提示词'}
        placeholder={
          activePreset && !promptMode
            ? activePreset.hint
            : promptMode
              ? '输入提示词（下游生成节点读的就是这里）'
              : '输入提示词，或连线上游提示词节点'
        }
        mentionOpen={mentionOpen}
        mentionPos={mentionPos}
        mentionCandidates={mentionCandidates}
        mentionHashOf={mentionHashOf}
        mentionThumbRef={mentionThumbRef}
        mentionThumbVersion={mentionThumbVersion}
        mentionThumbOf={mentionThumbOf}
        promptToggle={model.promptToggle}
        promptMode={promptMode}
        promptLength={model.prompt.length}
        toolError={tools?.error}
        onToggleExpand={togglePromptExpand}
        onPromptValueChange={onPromptValueChange}
        onMentionTrigger={openMentionAtCaret}
        onChipClick={onClickPromptChip}
        onPromptBlur={onPromptBlur}
        onInsertMention={insertMention}
        onMentionThumbLoaded={() => setMentionThumbVersion((version) => version + 1)}
        onTogglePrompt={() => onEvent({ type: 'togglePrompt' })}
      />

      <section
        className={`${styles.section} ${styles.params} ${styles.paramsSection}`}
        data-panel-part="params"
      >
        <CreationParameterControls
          noPlatform={noPlatform}
          platformGap={platformGap}
          categoryLabel={categoryLabel}
          modelLabel={shownLogicalModel || defaultModelLabel}
          modelOptions={modelOptions}
          modelValue={shownLogicalModel}
          modelOpen={openPicker === 'model'}
          videoModeLabel={VIDEO_MODE_LABELS[quality.videoModeValue].label}
          promptMode={promptMode}
          videoMode={videoMode}
          quality={quality}
          paramSections={paramSections}
          isMj={isMj}
          mjSections={mjSections}
          openPicker={openPicker}
          onOpenSettings={() => onEvent({ type: 'openSettings' })}
          onTogglePicker={togglePicker}
          onClosePicker={closePicker}
          onSelectModel={selectModel}
          onSelectVideoMode={selectVideoMode}
          onSelectRatio={selectRatio}
          onSelectSize={selectSize}
          onDurationChange={setDurationSeconds}
          onSelectGenerateAudio={selectGenerateAudio}
          onSelectCount={selectCount}
        />
        <CreationPromptToolsView
          promptMode={promptMode}
          tools={tools}
          skills={skills}
          model={model}
          promptImageCount={props.promptImageCount ?? 0}
          onSelectSkill={(skillId) => onEvent({ type: 'selectSkill', skillId })}
          onOpenSkills={props.onOpenSkills}
          onRunTool={runPromptTool}
        />
        <CreationRunActionsView
          promptMode={promptMode}
          activePreset={activePreset}
          presetOptionsAvailable={activePreset?.options != null}
          presetOpen={presetOpen}
          presetOptionsOpen={presetOptionsOpen}
          model={model}
          emotionOn={emotionOn}
          running={props.running}
          busyGlobal={busyGlobal}
          runDisabled={runDisabled}
          runLabel={runLabel}
          runTitle={runTitle}
          blockedReason={blockedReason}
          disabled={props.disabled === true}
          error={props.error}
          onTogglePreset={togglePreset}
          onPickPreset={pickPreset}
          onPickEmotion={pickEmotion}
          onPickPresetOption={pickPresetOption}
          onRunAction={() => onEvent({ type: props.running ? 'cancel' : 'run' })}
        />
      </section>
    </div>
  )
}

/**
 * `@` 候选行左边那块小缩略图。
 *
 * 与 chip 上那张图是**两条路**：chip 的图由编辑器按 `thumbOf` 就地补（它是命令式 DOM）；
 * 这里是普通 React 行，直接用 `useAsset` 拿 objectURL 就行 —— 别为了「统一」把
 * 菜单也做成命令式，那只会多一份要维护的 DOM。
 */

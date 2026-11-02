import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from 'react'
import type { AgentDeliveryMode } from '../../../../domain/agent/delivery'
import type { SkillEntity } from '../../../../domain/prompt/skill'
import type { PresetVendor } from '../../../../domain/project/modelPresets'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { AGENT_CONTEXT_WINDOW } from '../../../../state/agent/sessionStore'
import {
  AGENT_COMPOSER_HEIGHT_MIN,
  agentComposerMaxHeight,
} from './agentComposerLayout'
import {
  LibraryThumb,
  statusIsBusy,
  type AgentPanelStatus,
} from './AgentActivityViews'
import { withModelIcons } from './agentPanelViewHelpers'
import {
  IconArrowUp,
  IconAuto,
  IconChat,
  IconClose,
  IconManual,
  IconMention,
  IconModelCube,
  IconPlus,
  IconSettings,
  IconSkill,
} from '../../toolbar/icons'
import { AssetMenu } from '../AssetMenu'
import { ParamPicker } from '../ParamPicker'
import {
  MentionEditor,
  type MentionEditorHandle,
  type MentionRef,
} from '../../text/MentionEditor'
import { SkillMenu } from './SkillMenu'
import styles from './AgentPanel.module.css'

export interface AgentComposerPaneProps {
  current: AgentSession | null
  status: AgentPanelStatus
  deliveryMode: AgentDeliveryMode
  draft: string
  composerHeight: number
  composerResizing: boolean
  openPicker: string | null
  shownModel: string
  chatModelOptions: readonly string[]
  modelOptionsByKind: {
    image: readonly string[]
    video: readonly string[]
  }
  globalImageModels: readonly string[]
  globalVideoModels: readonly string[]
  mentionedModels: ReadonlySet<string>
  graph: {
    nodes: readonly { id: string; title?: string; type: string }[]
  }
  libraryAssets: readonly {
    hash: string
    prompt?: string
    mime: string
  }[]
  allSkills: readonly { id: string; name: string }[]
  skillLabel: string
  skillFavs: readonly string[]
  skills: {
    builtinSkills: readonly SkillEntity[]
    userSkills: readonly SkillEntity[]
  }
  thumbVersion: number
  editorRef: MutableRefObject<MentionEditorHandle | null>
  composerRef: MutableRefObject<HTMLDivElement | null>
  fileRef: MutableRefObject<HTMLInputElement | null>
  skillFileRef: MutableRefObject<HTMLInputElement | null>
  skillDirRef: MutableRefObject<HTMLInputElement | null>
  composerAvailableHeight(): number
  beginComposerResize(event: ReactPointerEvent<HTMLButtonElement>): void
  resizeComposerWithKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>): void
  replaceDraft(next: string): void
  send(mode?: AgentDeliveryMode): void
  stop(): void
  attachFiles(files: FileList | null): void
  addFromLibrary(hash: string): void
  pickModel(name: string): void
  setModelKind(kind: 'imageModel' | 'videoModel', value: string): void
  setSkill(id: string): void
  toggleSkillFavorite(id: string): void
  openSkillLibrary(): void
  importSkills(files: FileList | null): void
  patchSession(patch: { contextWindow?: number }): void
  setAutoRun(value: boolean): void
  insertMention(kind: MentionRef['kind'], id: string, label: string): void
  setDraft: Dispatch<SetStateAction<string>>
  setOpenPicker: Dispatch<SetStateAction<string | null>>
  thumbOf(id: string): string | null
  channels: {
    globalModelOf(name: string): { vendor: PresetVendor } | undefined
  }
  library: {
    load(): Promise<unknown>
  }
}

export function AgentComposerPane({
  current,
  status,
  deliveryMode,
  draft,
  composerHeight,
  composerResizing,
  openPicker,
  shownModel,
  chatModelOptions,
  modelOptionsByKind,
  globalImageModels,
  globalVideoModels,
  mentionedModels,
  graph,
  libraryAssets,
  allSkills,
  skillLabel,
  skillFavs,
  skills,
  thumbVersion,
  editorRef,
  composerRef,
  fileRef,
  skillFileRef,
  skillDirRef,
  composerAvailableHeight,
  beginComposerResize,
  resizeComposerWithKeyboard,
  replaceDraft,
  send,
  stop,
  attachFiles,
  addFromLibrary,
  pickModel,
  setModelKind,
  setSkill,
  toggleSkillFavorite,
  openSkillLibrary,
  importSkills,
  patchSession,
  setAutoRun,
  insertMention,
  setDraft,
  setOpenPicker,
  thumbOf,
  channels,
  library,
}: AgentComposerPaneProps) {
  return (
    <>
      {/*
        对话模型 = **agent 自己的 LLM**，单独一处（用户 2026-10-02：「对话模型是
        agent 的 llm，需要单独放在一个地方」）。
      */}
      <div className={styles.llmRow} data-agent-llm-row>
        <ParamPicker
          name="agent-chat-model"
          ariaLabel={`对话模型（agent 自己的 LLM，当前：${shownModel || '未选'}）`}
          label={shownModel || '选择对话模型'}
          triggerIcon={<IconChat size={14} />}
          size="compact"
          options={withModelIcons(chatModelOptions)}
          value={shownModel}
          variant="list"
          emptyHint="没有可用的对话模型：去后台设置里勾选"
          open={openPicker === 'agent-chat-model'}
          onToggle={() =>
            setOpenPicker(openPicker === 'agent-chat-model' ? null : 'agent-chat-model')
          }
          onClose={() => setOpenPicker(null)}
          onSelect={(v) => void pickModel(v)}
        />
      </div>

      {/*
        输入区：一个圆角盒子，**上正文、下工具条**（参考产品 liblib.tv 的对话框形态）。

        正文用 `MentionEditor`（contenteditable）而不是 `textarea`：用户 2026-10-02
        要「@ 引用的节点 / 模型在输入框里呈现为一个矩形、作为文本内容的一部分」，
        而 `textarea` 只能显示纯文本，做不到「一个矩形夹在文字中间」。
        素材标签也收在盒子里 —— 它们是「这次要说出去的东西」，不是面板参数。
      */}
      <div
        ref={composerRef}
        id="canvas-agent-composer"
        className={styles.composer}
        data-agent-composer
        data-agent-composer-height={composerHeight}
        data-agent-composer-resizing={composerResizing ? 'true' : 'false'}
        data-agent-delivery-mode={deliveryMode}
        style={{
          ['--agent-composer-height' as string]: `${composerHeight}px`,
        }}
      >
        <button
          type="button"
          className={styles.composerResizeHandle}
          role="separator"
          aria-orientation="horizontal"
          aria-controls="canvas-agent-composer-editor"
          aria-label="调整 Agent 输入框高度"
          aria-valuemin={AGENT_COMPOSER_HEIGHT_MIN}
          aria-valuemax={agentComposerMaxHeight(composerAvailableHeight())}
          aria-valuenow={composerHeight}
          title="向上拖动加高输入框；方向键微调"
          data-agent-composer-resize
          onPointerDown={beginComposerResize}
          onKeyDown={resizeComposerWithKeyboard}
        />
        {/*
          **没有独立的 chip 行了**（用户 2026-10-02：「agent 的 skill 选择后不要出现在
          图三的地方……点击节点后出现的把选中的节点当作此次的素材的时候都会出现在那里，
          我需要全部出现在正文里面，全部保持和艾特的出现的地方一样」）。

          技能 / 生成模型 / 取选中素材现在**一律落成正文里的引用 chip**（`skill:` /
          `model:` / `node:` 三种 token），与 @ 引用同一套锚点与呈现：
          · 插入：`insertMention(...)`（见上面各处的 onSelect / attachFiles）；
          · 会话字段仍然照写（技能、图片 / 视频模型、素材 id），因为提示词与落地配方
            读的是它们 —— 正文是**看得见的记录**，会话行是**真正生效的设置**；
          · 进一个会话时只把素材 chip 补回正文（见下面那个 `restoredSessionRef` 的
            effect）；技能设置照常生效，但必须由用户主动选择后才显示 chip。
        */}

        <MentionEditor
          ref={editorRef}
          value={draft}
          onChange={replaceDraft}
          className={styles.composerEditor}
          /** 语义锚点：冒烟按 `[data-agent-input]` 定位这个输入框 */
          anchorAttr={{
            'data-agent-input': '',
            id: 'canvas-agent-composer-editor',
          }}
          placeholder="开始你的创作，或者 @ 引用工作流 / 节点 / 资源"
          onEnter={(modifiers) => {
            const opposite = deliveryMode === 'queue' ? 'steer' : 'queue'
            void send(
              modifiers.ctrlKey || modifiers.metaKey ? opposite : deliveryMode,
            )
          }}
          /** 刚打出 `@` → 直接开引用菜单（参考产品就是「打 @ 就出」） */
          onMentionTrigger={() => setOpenPicker('agent-mention')}
          /** 节点引用的缩略图：宿主取图，编辑器就地补进 chip 的槽位 */
          thumbOf={thumbOf}
          thumbVersion={thumbVersion}
        />

        <div className={styles.bar}>
          <div className={styles.barPills}>
            {/*
              加素材：**两条路**（用户 2026-10-03：「加素材是要的，他分两个功能，
              点击后本地上传和素材库添加，也是要有图标」）。

              菜单复用画布既有的 `AssetMenu`（图标 + 文案）—— 与节点素材右上角那个
              是同一个组件，只是这次朝**上**展开（工具条在面板底部）。
            */}
            <span className={styles.addWrap}>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setOpenPicker(openPicker === 'agent-asset' ? null : 'agent-asset')}
                title="加素材（本地上传 / 素材库）"
                data-agent-add-asset
              >
                <IconPlus size={16} />
              </button>
              {openPicker === 'agent-asset' && (
                <AssetMenu
                  anchor="above"
                  onClose={() => setOpenPicker(null)}
                  items={[
                    {
                      id: 'upload',
                      label: '本地上传',
                      hint: '从这台电脑选图片或视频',
                      icon: 'upload',
                      onSelect: () => fileRef.current?.click(),
                    },
                    {
                      id: 'library',
                      label: '素材库添加',
                      hint: '从「我的素材」里挑一个',
                      icon: 'library',
                      onSelect: () => {
                        setOpenPicker('agent-library')
                        void library.load()
                      },
                    },
                  ]}
                />
              )}
              {openPicker === 'agent-library' && (
                <div
                  className={styles.library}
                  data-agent-library
                  role="dialog"
                  aria-label="从素材库添加"
                >
                  {libraryAssets.length === 0 ? (
                    <span className={styles.libraryEmpty}>
                      素材库还是空的：去「我的素材」收藏几张再用
                    </span>
                  ) : (
                    libraryAssets.map((a) => (
                      <button
                        key={a.hash}
                        type="button"
                        className={styles.libraryItem}
                        title={a.prompt ?? a.mime}
                        data-agent-library-item={a.hash}
                        onClick={() => {
                          void addFromLibrary(a.hash)
                          setOpenPicker(null)
                        }}
                      >
                        <LibraryThumb hash={a.hash} />
                      </button>
                    ))
                  )}
                  <button
                    type="button"
                    className={styles.libraryClose}
                    onClick={() => setOpenPicker(null)}
                    aria-label="关闭素材库"
                    data-agent-library-close
                  >
                    <IconClose size={12} />
                  </button>
                </div>
              )}
            </span>
            {/*
              工具条剩下的四件事（用户 2026-10-02 第二轮）：
              **@ 引用 / 模型 / 技能 / 手动·自动**。

              三处形态上的决定都是用户点名的：
              ① 「模型用一个 3d 建模的图标展示，立体的方形」「skill 也是用一个图标展示」
                 ⇒ 这两枚 chip **只显示图标、不写字**（`triggerIcon` + `label=""`），
                 名字进 `aria-label`（悬停 / 读屏可见），列表里照旧带名字与厂商 logo；
              ② 「参数去掉，只保留模型的选项」⇒ 比例 / 画质 / 质量那一枚**整个撤掉**
                 （会话字段与提示词那段仍留着，见 §8：入口先撤、口径不撤，
                 免得下次要加回来时又得从提示词一路重接）；
              ③ 「手动和自动用图标进行替换，选中能替换」⇒ 图标本身跟着**当前档位**换
                 （手 / 循环箭头），不是只在菜单里高亮。
            */}

            {/*
              @ 引用：一个浮层里三段 —— **节点**（这张画布上的）/ **图片** / **视频**
              （后两段只列前端固定清单，见下面各段自己的说明）。
              选完插进输入框成为一颗矩形 chip，是文本内容的一部分（`MentionEditor`）。
            */}
            <ParamPicker
              name="agent-mention"
              ariaLabel="引用画布里的节点或模型"
              label=""
              triggerIcon={<IconMention size={16} />}
              size="compact"
              closeOnSelect
              sections={[
                {
                  name: 'node',
                  label: '节点',
                  variant: 'list',
                  /**
                   * 只先摆 5 条 + 「加载更多」（用户 2026-10-02 参考产品图二：
                   * 「不用显示全部可以艾特的节点，下方有省略，点击之后才会显示所有的」）。
                   * 画布上几十个节点时，这一层不折叠会把模型那一段挤到看不见。
                   */
                  collapsedCount: 5,
                  options: graph.nodes.map((n) => ({
                    value: `node:${n.id}`,
                    label: (n.title ?? '').trim() || n.type,
                    hint: n.type,
                  })),
                  value: '',
                  emptyHint: '这张画布上还没有节点',
                  onSelect: (v) => {
                    const id = v.slice('node:'.length)
                    const hit = graph.nodes.find((n) => n.id === id)
                    insertMention('node', id, (hit?.title ?? '').trim() || id)
                  },
                },
                /**
                 * **@ 里的模型 = 生图 / 生视频模型**（用户 2026-10-04：
                 * 「艾特按钮我要能图片模型和视频模型，就是前端的那几个，
                 *   千万不要把渠道拉取的模型放上去」）。
                 *
                 * 三条口径写死在这里：
                 * ① **只用前端固定清单**（`presetModelsOf`）—— 不用 `panelModelOptions`，
                 *    因为后者会把「渠道里勾选的模型」也并进来（中转站一次拉回几百个，
                 *    全塞进 @ 面板就是灾难，而且那些名字不是用户在创作面板上认识的名字）；
                 * ② **不含对话模型** —— agent 自己的 LLM 由工具条上那枚模型按钮管，
                 *    @ 里的模型是「这次用哪些模型去生成」（用户 2026-10-04 第 3 条）；
                 * ③ 选一枚 = **往正文里插一枚 chip**（与创作面板的模型 chip 同一套），
                 *    可以连着插多枚 —— 那就是「多个模型参与的流程」的输入方式。
                 */
                {
                  name: 'image',
                  label: '图片',
                  variant: 'list',
                  /** 一屏 5 条，多的在里面滚（与模型面板同一口径） */
                  maxRows: 5,
                  options: withModelIcons(
                    globalImageModels,
                    undefined,
                    channels.globalModelOf,
                  ),
                  value: '',
                  emptyHint: '还没有图片模型',
                  onSelect: (v) => insertMention('model', v, v),
                },
                {
                  name: 'video',
                  label: '视频',
                  variant: 'list',
                  maxRows: 5,
                  options: withModelIcons(
                    globalVideoModels,
                    undefined,
                    channels.globalModelOf,
                  ),
                  value: '',
                  emptyHint: '还没有视频模型',
                  onSelect: (v) => insertMention('model', v, v),
                },
              ]}
              open={openPicker === 'agent-mention'}
              onToggle={() => setOpenPicker(openPicker === 'agent-mention' ? null : 'agent-mention')}
              onClose={() => setOpenPicker(null)}
            />

            {/*
              模型面板 = 「**这次用哪些模型去生成**」（用户 2026-10-04 第 3 条：
              「不是默认用这两个模型的意思，是把模型放在对话框中，意思是用这些模型
                进行生成，能组成多个模型参与的流程」）。

              与旧口径的差别只有一处，但很要紧：**✓ 表示「已放进这次对话」**，
              不表示「这是默认模型」。所以：
                · 点一枚 = 往正文插一枚 `model` chip（与 @ 模型同一条路）+ 顺手把它
                  记成该类的默认值（用户一枚都没 @ 时，新节点仍要有模型可用）；
                · 勾选状态读**正文里的引用**（`mentionedModels`），可以同时勾好几枚；
                · 图片 / 视频两段的清单仍是「前端固定清单 + 渠道已勾选模型的归一显示名」，
                  与创作面板同源。
              清单与创作面板**同一份数据源**（`panelModelOptions`），再按「有没有渠道真能提供它」筛一道。
            */}
            <ParamPicker
              name="agent-model"
              ariaLabel={`这次用哪些模型生成（已放进对话 ${mentionedModels.size} 枚）`}
              label=""
              triggerIcon={<IconModelCube size={16} />}
              size="compact"
              closeOnSelect
              jumpMode="filter"
              /**
               * 顶部两枚跳转（用户 2026-10-02：「上方需要有两个选项，分别是图片、视频，
               * 点击按钮可以进行跳转到下面的选项，例如选图片就从图片的开头开始」）。
               */
              jumps={[
                { section: 'image', label: '图片' },
                { section: 'video', label: '视频' },
              ]}
              sections={[
                {
                  name: 'image',
                  label: '图片',
                  variant: 'list',
                  /** 一屏只摆 5 条，多的在里面滚（用户 2026-10-02：「太高了」） */
                  maxRows: 5,
                  /** 高亮 = 「已放进这次对话」（见 `mentionedModels`），不是会话默认值 */
                  options: withModelIcons(modelOptionsByKind.image, mentionedModels),
                  value: '',
                  emptyHint: '没有可用的图片模型',
                  onSelect: (v) => {
                    void setModelKind('imageModel', v)
                    /**
                     * 生成模型也进**正文**（用户 2026-10-02：「选择模型后也是要加入到
                     * 对话框中参与对话（和艾特模型的功能一样）」）—— 与 @ 模型同一套 chip。
                     */
                    if (v) insertMention('model', v, v)
                  },
                },
                {
                  name: 'video',
                  label: '视频',
                  variant: 'list',
                  maxRows: 5,
                  options: withModelIcons(modelOptionsByKind.video, mentionedModels),
                  value: '',
                  emptyHint: '没有可用的视频模型',
                  onSelect: (v) => {
                    void setModelKind('videoModel', v)
                    if (v) insertMention('model', v, v)
                  },
                },
              ]}
              open={openPicker === 'agent-model'}
              onToggle={() => setOpenPicker(openPicker === 'agent-model' ? null : 'agent-model')}
              onClose={() => setOpenPicker(null)}
            />

            {/*
              技能：图标按钮 + **技能菜单**（用户 2026-10-03，参考产品图三 / 图四）。
              菜单里能按「通用 / 我的」分类、搜索、创建、导入（.md 或文件夹）；
              「全部」去技能库那一页。
            */}
            <span className={styles.addWrap}>
              <button
                type="button"
                className={styles.iconBtn}
                title={current?.skillId ? `技能：${skillLabel}` : '选择技能'}
                aria-label={`这份技能决定 agent 把哪些阶段建到画布上（当前：${skillLabel}）`}
                data-agent-skill-open
                onClick={() => setOpenPicker(openPicker === 'agent-skill' ? null : 'agent-skill')}
              >
                <IconSkill size={16} />
              </button>
              {openPicker === 'agent-skill' && (
                <SkillMenu
                  builtin={skills.builtinSkills}
                  user={skills.userSkills}
                  favorites={skillFavs}
                  activeId={current?.skillId ?? null}
                  onSelect={(id) => {
                    void setSkill(id ?? '')
                    /**
                     * 技能也落成**正文里的一枚 chip**（用户 2026-10-02：「agent 的 skill
                     * 选择后不要出现在图三的地方……我需要全部出现在正文里面，全部保持和
                     * 艾特的出现的地方一样」）。取消选择时把那枚 chip 一并抹掉。
                     */
                    if (id) {
                      const hit = allSkills.find((s) => s.id === id)
                      insertMention('skill', id, hit?.name ?? '技能')
                    } else {
                      setDraft((prev) => prev.replace(/\s*@\[[^\]]*\]\(skill:[^)]*\)/g, '').trim())
                    }
                    setOpenPicker(null)
                  }}
                  onToggleFavorite={(id) => void toggleSkillFavorite(id)}
                  onCreateNew={openSkillLibrary}
                  onImportFiles={() => skillFileRef.current?.click()}
                  onImportFolder={() => skillDirRef.current?.click()}
                  onClose={() => setOpenPicker(null)}
                />
              )}
              <input
                ref={skillFileRef}
                type="file"
                accept=".md,.markdown,.txt,text/markdown"
                multiple
                hidden
                data-agent-skill-file
                onChange={(e) => {
                  void importSkills(e.target.files)
                  e.target.value = ''
                }}
              />
              {/*
                文件夹导入用 `webkitdirectory`：它与 `accept` 互斥（设了它就只能选目录），
                所以和上面那个文件输入**分成两个**，而不是硬塞进一个。
              */}
              <input
                ref={skillDirRef}
                type="file"
                multiple
                hidden
                data-agent-skill-dir
                {...({ webkitdirectory: '' } as Record<string, string>)}
                onChange={(e) => {
                  void importSkills(e.target.files)
                  e.target.value = ''
                }}
              />
            </span>

            {/*
              回读轮数（用户 2026-10-14 参考产品图二）：发给模型的**上下文窗口**。
              只影响「这一次给模型看多少」—— 更早的历史仍全量留在库里与界面上，
              省掉的那段在结果回来时拼回去（见 `sendText` 的 `hidden`）。
            */}
            <ParamPicker
              name="agent-context"
              ariaLabel={`回读 ${current?.contextWindow ?? AGENT_CONTEXT_WINDOW} 条`}
              label=""
              triggerIcon={<IconSettings size={16} />}
              size="compact"
              variant="list"
              options={[3, 5, 10, 20, 50, 100, 150, 200].map((n) => ({
                value: String(n),
                label: `回读 ${n} 条`,
              }))}
              value={String(current?.contextWindow ?? AGENT_CONTEXT_WINDOW)}
              open={openPicker === 'agent-context'}
              onToggle={() =>
                setOpenPicker(openPicker === 'agent-context' ? null : 'agent-context')
              }
              onClose={() => setOpenPicker(null)}
              onSelect={(v) => void patchSession({ contextWindow: Number(v) })}
            />

            {/*
              手动 / 自动生成（参考产品图一那一档）：两个候选各带一句后果说明。
              图标跟着当前档位换 —— 「选中能替换」指的就是这一枚。
            */}
            <ParamPicker
              name="agent-autorun"
              ariaLabel={
                current?.autoRun
                  ? '自动生成：不再逐步询问'
                  : '手动生成：每次生成前问你一句'
              }
              label=""
              triggerIcon={current?.autoRun ? <IconAuto size={16} /> : <IconManual size={16} />}
              size="compact"
              variant="list"
              options={[
                {
                  value: 'manual',
                  label: '手动生成',
                  hint: '每次生成前询问',
                  icon: <IconManual size={16} />,
                },
                {
                  value: 'auto',
                  label: '自动生成',
                  hint: '直接消耗积分',
                  icon: <IconAuto size={16} />,
                },
              ]}
              value={current?.autoRun ? 'auto' : 'manual'}
              open={openPicker === 'agent-autorun'}
              onToggle={() =>
                setOpenPicker(openPicker === 'agent-autorun' ? null : 'agent-autorun')
              }
              onClose={() => setOpenPicker(null)}
              onSelect={(v) => void setAutoRun(v === 'auto')}
            />
          </div>

          {/*
            发送钮的形态与**内容**有关（像参考产品：没写字就只是个圆点，写了才是可点的上箭头），
            与「是否在执行」无关 —— 执行中它变成停止，这一层含义独立表达。
          */}
          {(status.kind === 'thinking' ||
            status.kind === 'toolRunning' ||
            status.kind === 'executing') && (
            <button
              type="button"
              className={`${styles.send} ${styles.sendBusy}`}
              onClick={() => void stop()}
              title="停止"
              data-agent-stop
            >
              <IconClose size={16} />
            </button>
          )}
          {draft.trim() ? (
            <button
              type="button"
              className={`${styles.send} ${styles.sendActive}`}
              onClick={() => void send(deliveryMode)}
              title={
                statusIsBusy(status)
                  ? deliveryMode === 'steer'
                    ? '引导当前任务'
                    : '加入队列'
                  : '发送'
              }
              data-agent-send
            >
              <IconArrowUp size={16} />
            </button>
          ) : !statusIsBusy(status) ? (
            <span className={styles.sendIdle} data-agent-send-idle aria-hidden="true" />
          ) : null}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          data-agent-file
          onChange={(e) => {
            void attachFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
    </>
  )
}

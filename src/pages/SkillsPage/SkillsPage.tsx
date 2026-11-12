import { useState } from 'react'
import { usePresetText } from '../../app/providers/PresetTextProvider'
import { sendSkillToAgent } from '../../features/canvas/agentSkillHandoff'
import { presetTextEntries } from '../../domain/prompt/presetText'
import type { BuiltinSkill, UserSkill } from '../../domain/prompt/skill'
import { noticeA11y } from '../../domain/ui/notice'
import { activeCanvasId } from '../../state/project/activeCanvas'
import { PresetTextSection } from './PresetTextSection'
import { SkillEditor } from './SkillEditor'
import { SkillLibraryView } from './SkillLibraryView'
import type { SkillCardPick } from './SkillsBrowser'
import type { AgentSkillTarget } from './skillAgentResolve'
import { useSkillLibraryState } from './useSkillLibraryState'
import styles from './SkillsPage.module.css'

type Draft = Omit<UserSkill, 'id' | 'updatedAt' | 'source'>

/** 技能页的「加入 Agent」：跨页 handoff，打开画布对话后作为技能 chip 加入。 */
function handOffToActiveCanvas(skill: AgentSkillTarget): string | { error: string } {
  const projectId = activeCanvasId()
  if (!projectId) return { error: '还没有可接收技能的画布，请先打开一个画布项目。' }
  sendSkillToAgent(projectId, skill.id)
  return `已将「${skill.name}」交给 Agent，打开画布对话后会作为技能 chip 加入。`
}

export function SkillsPage() {
  const presetText = usePresetText()
  const presetsList = presetTextEntries(presetText.overrides)
  const library = useSkillLibraryState(handOffToActiveCanvas)
  const { notice } = library

  const [level, setLevel] = useState<'browse' | 'edit' | 'presets'>('browse')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [originalId, setOriginalId] = useState<string | null>(null)
  const [builtin, setBuiltin] = useState<BuiltinSkill | null>(null)

  const openSkill = (pick: SkillCardPick) => {
    if (pick.kind === 'libtv') return
    setDraft({
      name: pick.skill.name,
      description: pick.skill.description,
      content: pick.skill.content,
      inputMode: pick.skill.inputMode,
      tags: pick.skill.tags,
      builtinId: pick.kind === 'user' ? pick.skill.builtinId : undefined,
      libtvId: pick.kind === 'user' ? pick.skill.libtvId : undefined,
    })
    setBuiltin(pick.kind === 'builtin' ? pick.skill : null)
    setOriginalId(pick.kind === 'user' ? pick.skill.id : null)
    library.setDetail(null)
    setLevel('edit')
  }

  const openNew = (empty: Draft) => {
    library.setSource('mine')
    library.setQuery('')
    setDraft(empty)
    setOriginalId(null)
    setBuiltin(null)
    setLevel('edit')
  }

  const backToBrowse = () => {
    setLevel('browse')
    setDraft(null)
    setOriginalId(null)
    setBuiltin(null)
  }

  return (
    <div className={styles.page} data-skills-page>
      {notice ? (
        <div
          className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeErr}
          data-skills-action-notice={notice.kind}
          {...noticeA11y(notice.kind === 'error' ? 'error' : 'info')}
        >
          {notice.text}
        </div>
      ) : null}

      {level === 'edit' && draft ? (
        <div className={styles.editorStage} data-skill-editor-stage>
          <div className={styles.levelBar}>
            <button type="button" className={styles.ghost} data-skills-back onClick={backToBrowse}>
              ← 返回技能库
            </button>
            <span className={styles.levelTitle}>
              {builtin ? '内置技能（只读）' : originalId ? '编辑技能' : '新建技能'}
            </span>
          </div>
          <SkillEditor
            draft={draft}
            originalId={originalId}
            builtin={builtin}
            onChange={setDraft}
            onSaved={backToBrowse}
            onDeleted={backToBrowse}
            onCopied={(copy) => {
              setDraft({
                name: copy.name,
                description: copy.description,
                content: copy.content,
                inputMode: copy.inputMode,
                tags: copy.tags,
                builtinId: copy.builtinId,
                libtvId: copy.libtvId,
              })
              setBuiltin(null)
              setOriginalId(copy.id)
            }}
          />
        </div>
      ) : null}

      {level === 'presets' ? (
        <div className={styles.presetsStage} data-presets-stage>
          <div className={styles.levelBar}>
            <button type="button" className={styles.ghost} data-presets-back onClick={backToBrowse}>
              ← 返回技能库
            </button>
            <span className={styles.levelTitle}>功能预设词</span>
          </div>
          <PresetTextSection presets={presetsList} presetText={presetText} />
        </div>
      ) : null}

      {level === 'browse' ? (
        <div className={styles.browserStage} data-skills-browser-stage>
          <SkillLibraryView
            state={library}
            onNew={openNew}
            onOpenPresets={() => setLevel('presets')}
            onEdit={openSkill}
          />
        </div>
      ) : null}
    </div>
  )
}

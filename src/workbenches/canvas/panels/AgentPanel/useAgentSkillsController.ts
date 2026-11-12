import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { useNavigate } from 'react-router-dom'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { PresetStore } from '../../../../state/project/presetStore'
import type { SkillStoreApi } from '../../../../app/providers/SkillStoreProvider'
import {
  parseSkillMarkdown,
  type SkillEntity,
} from '../../../../domain/prompt/skill'
import {
  requestAgentSkillLibrary,
  subscribeAgentSkillHandoff,
  takeAgentSkillHandoffs,
} from '../../../../features/canvas/agentSkillHandoff'
import type { TaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'
import { mentionToken, parseMentions } from '../../text/MentionEditor'

export interface AgentSkillsControllerInput {
  active: boolean
  projectId: string
  current: AgentSession | null
  allSkills: readonly SkillEntity[]
  setDraft: Dispatch<SetStateAction<string>>
  patchSession: (patch: { skillId?: string }) => Promise<unknown>
  setOpenPicker: Dispatch<SetStateAction<string | null>>
  skills: Pick<SkillStoreApi, 'create' | 'reload'>
  presets: Pick<PresetStore, 'loadSkillFavorites' | 'saveSkillFavorites'>
  notify: (message: string, tone?: 'info' | 'error') => void
  trackRun: TaskLifecycle['track']
}

export interface AgentSkillsController {
  skillFavs: readonly string[]
  skillLabel: string
  skillFileRef: MutableRefObject<HTMLInputElement | null>
  skillDirRef: MutableRefObject<HTMLInputElement | null>
  setSkill: (skillId: string) => Promise<void>
  importSkills: (files: FileList | null) => Promise<void>
  openSkillLibrary: () => void
  toggleSkillFavorite: (id: string) => Promise<void>
}

/**
 * Agent 技能区的 React 适配：会话技能选择、技能导入、收藏与跨入口 handoff。
 * 技能正文和持久化仍由 SkillStore 负责，这里不执行模型请求或画布工具。
 */
export function useAgentSkillsController(
  input: AgentSkillsControllerInput,
): AgentSkillsController {
  const navigate = useNavigate()
  const [skillFavs, setSkillFavs] = useState<readonly string[]>([])
  const skillFileRef = useRef<HTMLInputElement | null>(null)
  const skillDirRef = useRef<HTMLInputElement | null>(null)

  const skillLabel = useMemo(() => {
    const id = input.current?.skillId
    if (!id) return '技能'
    return input.allSkills.find((skill) => skill.id === id)?.name ?? '技能'
  }, [input.allSkills, input.current?.skillId])

  const setDraftRef = useRef(input.setDraft)
  setDraftRef.current = input.setDraft
  const currentId = input.current?.id
  useEffect(() => {
    if (!input.active || !currentId) return
    const consumePendingSkill = () => {
      const known = new Map(input.allSkills.map((skill) => [skill.id, skill]))
      const ids = takeAgentSkillHandoffs(input.projectId, (id) => known.has(id))
      if (ids.length === 0) return
      setDraftRef.current((previous) => {
        let next = previous
        for (const id of ids) {
          const skill = known.get(id)!
          const already = parseMentions(next).some(
            (mention) => mention.kind === 'skill' && mention.id === skill.id,
          )
          if (already) continue
          const marker = mentionToken('skill', skill.id, skill.name)
          next = next.trim()
            ? `${next.replace(/\s+$/, '')} ${marker} `
            : `${marker} `
        }
        return next
      })
    }
    consumePendingSkill()
    return subscribeAgentSkillHandoff(input.projectId, consumePendingSkill)
  }, [currentId, input.active, input.allSkills, input.projectId])

  useEffect(() => {
    let alive = true
    void input.presets.loadSkillFavorites().then((ids) => {
      if (alive) setSkillFavs(ids)
    })
    return () => {
      alive = false
    }
  }, [input.presets])

  const setSkill = useCallback(
    async (skillId: string) => {
      await input.patchSession({ skillId: skillId || undefined })
    },
    [input.patchSession],
  )

  const importSkills = useCallback(
    (files: FileList | null) =>
      input.trackRun(async () => {
        if (!files || files.length === 0) return
        let ok = 0
        const failed: string[] = []
        for (const file of Array.from(files)) {
          if (!/\.(md|markdown|txt)$/i.test(file.name)) continue
          try {
            const parsed = parseSkillMarkdown(
              await file.text(),
              file.name.replace(/\.(md|markdown|txt)$/i, ''),
            )
            if (!parsed.ok) {
              failed.push(`${file.name}：${parsed.error}`)
              continue
            }
            await input.skills.create(parsed.skill)
            ok += 1
          } catch (error) {
            failed.push(
              `${file.name}：${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        await input.skills.reload()
        input.setOpenPicker(null)
        input.notify(
          failed.length === 0
            ? `已导入 ${ok} 条技能`
            : `导入 ${ok} 条，${failed.length} 条失败：${failed[0]}`,
          failed.length === 0 ? 'info' : 'error',
        )
      }),
    [input.notify, input.setOpenPicker, input.skills, input.trackRun],
  )

  /**
   * 技能按钮（2026-11-12 用户：「点击 agent 的 skill 面板是调用一个居中画布的浮层面板」）：
   * 在画布页时交给画布页打开居中的技能库浮层；不在画布页（没有订阅者）才去技能页。
   */
  const openSkillLibrary = useCallback(() => {
    input.setOpenPicker(null)
    if (requestAgentSkillLibrary(input.projectId)) return
    navigate('/skills')
  }, [input.projectId, input.setOpenPicker, navigate])

  const toggleSkillFavorite = useCallback(
    (id: string) =>
      input.trackRun(async () => {
        const next = skillFavs.includes(id)
          ? skillFavs.filter((item) => item !== id)
          : [...skillFavs, id]
        setSkillFavs(next)
        await input.presets.saveSkillFavorites(next)
      }),
    [input.presets, input.trackRun, skillFavs],
  )

  return {
    skillFavs,
    skillLabel,
    skillFileRef,
    skillDirRef,
    setSkill,
    importSkills,
    openSkillLibrary,
    toggleSkillFavorite,
  }
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useSkills } from '../../app/providers/SkillStoreProvider'
import type { LibtvCategory, LibtvSourceGroup } from '../../domain/prompt/libtvSkill'
import { createPresetStore } from '../../state/project/presetStore'
import { loadLibtvSkillFiles } from '../../state/project/libtvSkillCatalog'
import { resolveSkillForAgent, type AgentSkillTarget } from './skillAgentResolve'
import type { SkillCardPick } from './SkillsBrowser'

export type SkillLibraryNotice = { kind: 'ok' | 'error'; text: string }

/**
 * 交给 Agent 的出口：返回成功提示文案；抛错或返回 `{ error }` 时显示错误提示。
 * 技能页走跨页 handoff，画布技能浮层直接投递给当前项目的 Agent。
 */
export type SkillLibraryAddToAgent = (
  skill: AgentSkillTarget,
) => string | { error: string } | Promise<string | { error: string }>

export interface SkillLibraryState {
  source: LibtvSourceGroup
  setSource: (source: LibtvSourceGroup) => void
  category: LibtvCategory
  setCategory: (category: LibtvCategory) => void
  query: string
  setQuery: (query: string) => void
  favorites: readonly string[]
  toggleFavorite: (pick: SkillCardPick) => Promise<void>
  detail: SkillCardPick | null
  setDetail: (pick: SkillCardPick | null) => void
  closeDetail: () => void
  busy: boolean
  notice: SkillLibraryNotice | null
  setNotice: (notice: SkillLibraryNotice | null) => void
  addToAgent: (pick: SkillCardPick) => Promise<void>
}

/** 技能库浏览态（来源 / 分类 / 搜索 / 收藏 / 详情 / 加入 Agent），技能页与画布技能浮层共用。 */
export function useSkillLibraryState(onAddToAgent: SkillLibraryAddToAgent): SkillLibraryState {
  const platform = usePlatform()
  const skills = useSkills()
  const presets = useMemo(() => createPresetStore(platform.storage), [platform])
  const [source, setSource] = useState<LibtvSourceGroup>('libtv')
  const [category, setCategory] = useState<LibtvCategory>('全部')
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<string[]>([])
  const [detail, setDetail] = useState<SkillCardPick | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<SkillLibraryNotice | null>(null)

  useEffect(() => {
    let alive = true
    void presets.loadSkillFavorites().then((ids) => {
      if (alive) setFavorites(ids)
    })
    return () => {
      alive = false
    }
  }, [presets])

  const closeDetail = useCallback(() => setDetail(null), [])

  const toggleFavorite = useCallback(
    async (pick: SkillCardPick) => {
      const id = pick.skill.id
      const next = favorites.includes(id)
        ? favorites.filter((item) => item !== id)
        : [...favorites, id]
      setFavorites(next)
      await presets.saveSkillFavorites(next)
    },
    [favorites, presets],
  )

  const addToAgent = useCallback(
    async (pick: SkillCardPick) => {
      setBusy(true)
      setNotice(null)
      try {
        const resolved = await resolveSkillForAgent(pick, {
          userSkills: skills.userSkills,
          create: skills.create,
          loadFiles: loadLibtvSkillFiles,
        })
        if (!resolved.ok) {
          setNotice({ kind: 'error', text: resolved.error })
          return
        }
        const result = await onAddToAgent(resolved.skill)
        setNotice(
          typeof result === 'string'
            ? { kind: 'ok', text: result }
            : { kind: 'error', text: result.error },
        )
      } catch (error) {
        setNotice({
          kind: 'error',
          text: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setBusy(false)
      }
    },
    [onAddToAgent, skills.create, skills.userSkills],
  )

  return {
    source,
    setSource,
    category,
    setCategory,
    query,
    setQuery,
    favorites,
    toggleFavorite,
    detail,
    setDetail,
    closeDetail,
    busy,
    notice,
    setNotice,
    addToAgent,
  }
}

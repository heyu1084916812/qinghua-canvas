import { createContext, useContext } from 'react'
import type { BuiltinSkill, SkillEntity, UserSkill } from '../../domain/prompt/skill'
import type { SkillStore } from '../../state/project/skillStore'

/**
 * 技能库共享状态的轻量 Context。
 *
 * 这里刻意不 import `createSkillStore`：那个模块会 eager glob 全部内置技能 Markdown，
 * 只读 Context 的面板 / 演示页不应为了拿一个 provider 引用先转换 700+ 份正文。
 */
export interface SkillStoreApi {
  skills: SkillEntity[]
  builtinSkills: BuiltinSkill[]
  userSkills: UserSkill[]
  loading: boolean
  reload: () => Promise<void>
  create: SkillStore['create']
  save: SkillStore['save']
  remove: SkillStore['remove']
  copyBuiltin: SkillStore['copyBuiltin']
  restoreBuiltin: SkillStore['restoreBuiltin']
}

export const SkillStoreContext = createContext<SkillStoreApi | null>(null)

export function useSkills(): SkillStoreApi {
  const store = useContext(SkillStoreContext)
  if (!store) throw new Error('SkillStoreProvider 未挂载')
  return store
}

export function useSkillsOptional(): SkillStoreApi {
  const store = useContext(SkillStoreContext)
  if (store) return store
  const missing = async () => {
    throw new Error('SkillStoreProvider 未挂载')
  }
  return {
    skills: [],
    builtinSkills: [],
    userSkills: [],
    loading: false,
    reload: async () => {},
    create: missing,
    save: missing,
    remove: missing,
    copyBuiltin: missing,
    restoreBuiltin: missing,
  }
}

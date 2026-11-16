import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { usePlatform } from './PlatformProvider'
import { createSkillStore } from '../../state/project/skillStore'
import type { BuiltinSkill, UserSkill } from '../../domain/prompt/skill'
import { SkillStoreContext, type SkillStoreApi as SkillStoreApiType } from './SkillStoreContext'

export {
  SkillStoreContext,
  useSkills,
  useSkillsOptional,
  type SkillStoreApi,
} from './SkillStoreContext'

export function SkillStoreProvider({ children }: { children?: ReactNode }) {
  const platform = usePlatform()
  const store = useMemo(() => createSkillStore(platform.storage), [platform])
  const [builtinSkills, setBuiltinSkills] = useState<BuiltinSkill[]>([])
  const [userSkills, setUserSkills] = useState<UserSkill[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const [builtins, users] = await Promise.all([store.loadBuiltin(), store.loadUser()])
    setBuiltinSkills(builtins)
    setUserSkills(users)
  }, [store])

  useEffect(() => {
    let alive = true
    void (async () => {
      const [builtins, users] = await Promise.all([store.loadBuiltin(), store.loadUser()])
      if (!alive) return
      setBuiltinSkills(builtins)
      setUserSkills(users)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [store])

  const api = useMemo<SkillStoreApiType>(
    () => ({
      skills: [...builtinSkills, ...userSkills],
      builtinSkills,
      userSkills,
      loading,
      reload,
      create: async (input) => {
        const created = await store.create(input)
        await reload()
        return created
      },
      save: async (skill) => {
        await store.save(skill)
        await reload()
      },
      remove: async (id) => {
        await store.remove(id)
        await reload()
      },
      copyBuiltin: async (builtin) => {
        const copied = await store.copyBuiltin(builtin)
        await reload()
        return copied
      },
      restoreBuiltin: async (builtin) => {
        const restored = await store.restoreBuiltin(builtin)
        await reload()
        return restored
      },
    }),
    [builtinSkills, userSkills, loading, reload, store],
  )

  return <SkillStoreContext.Provider value={api}>{children}</SkillStoreContext.Provider>
}

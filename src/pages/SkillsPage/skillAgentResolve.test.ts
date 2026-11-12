import { describe, expect, it, vi } from 'vitest'
import type { LibtvSkill } from '../../domain/prompt/libtvSkill'
import type { UserSkill } from '../../domain/prompt/skill'
import { resolveSkillForAgent, type ResolveAgentSkillDeps } from './skillAgentResolve'

const libtv = (over: Partial<LibtvSkill> = {}): LibtvSkill => ({
  id: 'lt-1', sourceId: 's', name: '分镜升镜师', description: 'd', useScenario: '', inputType: '',
  outputContent: '', resultType: 1, tags: [], recommended: false, cases: [], bodyFile: 'lt-1.md', ...over,
})
const user = (over: Partial<UserSkill> = {}) => ({ id: 'u-1', name: '我的', description: '', content: 'c', inputMode: 'any', tags: [], updatedAt: 1, source: 'user', ...over }) as UserSkill

function deps(over: Partial<ResolveAgentSkillDeps> = {}): ResolveAgentSkillDeps {
  return {
    userSkills: [],
    create: vi.fn(async (draft) => ({ ...user(), ...draft, id: 'u-new' }) as UserSkill),
    loadFiles: vi.fn(async () => [{ path: 'SKILL.md', content: '# 正文' }]),
    ...over,
  }
}

describe('resolveSkillForAgent（技能页与画布技能浮层共用）', () => {
  it('内置 / 我的技能直接用自身 id', async () => {
    const d = deps()
    await expect(resolveSkillForAgent({ kind: 'user', skill: user() }, d)).resolves.toEqual({ ok: true, skill: { id: 'u-1', name: '我的' } })
    expect(d.create).not.toHaveBeenCalled()
  })

  it('LibTV 已落成我的技能时复用，不重复创建', async () => {
    const d = deps({ userSkills: [user({ id: 'u-lt', name: '分镜升镜师', libtvId: 'lt-1' })] })
    await expect(resolveSkillForAgent({ kind: 'libtv', skill: libtv() }, d)).resolves.toEqual({ ok: true, skill: { id: 'u-lt', name: '分镜升镜师' } })
    expect(d.loadFiles).not.toHaveBeenCalled()
  })

  it('LibTV 首次加入时读正文并创建我的技能', async () => {
    const d = deps()
    const out = await resolveSkillForAgent({ kind: 'libtv', skill: libtv() }, d)
    expect(out).toEqual({ ok: true, skill: { id: 'u-new', name: '分镜升镜师' } })
    expect(d.create).toHaveBeenCalledWith(expect.objectContaining({ libtvId: 'lt-1', content: '# SKILL.md\n\n# 正文' }))
  })

  it('没有正文 / 读取失败时给出中文错误', async () => {
    await expect(resolveSkillForAgent({ kind: 'libtv', skill: libtv({ bodyFile: null }) }, deps())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('没有可执行') })
    await expect(resolveSkillForAgent({ kind: 'libtv', skill: libtv() }, deps({ loadFiles: async () => null }))).resolves.toMatchObject({ ok: false, error: expect.stringContaining('读取 Skill 正文失败') })
  })
})

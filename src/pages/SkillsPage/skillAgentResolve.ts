import type { UserSkill } from '../../domain/prompt/skill'
import {
  libtvAgentContentOf,
  libtvCategoryOf,
  libtvHasBody,
  type LibtvSkillFile,
} from '../../domain/prompt/libtvSkill'
import type { SkillStoreApi } from '../../app/providers/SkillStoreProvider'
import type { SkillCardPick } from './SkillsBrowser'

export interface AgentSkillTarget {
  id: string
  name: string
}

export type ResolveAgentSkillOutcome =
  | { ok: true; skill: AgentSkillTarget }
  | { ok: false; error: string }

export interface ResolveAgentSkillDeps {
  userSkills: readonly UserSkill[]
  create: SkillStoreApi['create']
  loadFiles: (skill: Extract<SkillCardPick, { kind: 'libtv' }>['skill']) => Promise<LibtvSkillFile[] | null>
}

/**
 * 把技能库里的一张卡解析成 Agent 能引用的技能 id。
 *
 * 内置 / 我的技能直接用自身 id；LibTV 目录条目先查是否已落成「我的技能」（按 libtvId），
 * 没有则读取正文创建一条，再交给 Agent。技能页与画布上的技能浮层共用这一条规则。
 */
export async function resolveSkillForAgent(
  pick: SkillCardPick,
  deps: ResolveAgentSkillDeps,
): Promise<ResolveAgentSkillOutcome> {
  if (pick.kind !== 'libtv') {
    return { ok: true, skill: { id: pick.skill.id, name: pick.skill.name } }
  }
  if (!libtvHasBody(pick.skill)) {
    return { ok: false, error: '这条目录没有可执行的 Skill 正文，暂不能添加到 Agent。' }
  }
  const existing = deps.userSkills.find((skill) => skill.libtvId === pick.skill.id)
  if (existing) return { ok: true, skill: { id: existing.id, name: existing.name } }
  const files = await deps.loadFiles(pick.skill)
  const content = files ? libtvAgentContentOf(files) : ''
  if (!content) return { ok: false, error: '读取 Skill 正文失败，暂不能添加到 Agent。' }
  const created = await deps.create({
    name: pick.skill.name,
    description: pick.skill.description,
    content,
    inputMode: 'any',
    tags: [libtvCategoryOf(pick.skill)],
    image: pick.skill.coverUrl ?? undefined,
    libtvId: pick.skill.id,
  })
  return { ok: true, skill: { id: created.id, name: created.name } }
}

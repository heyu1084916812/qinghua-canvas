import type { Skill } from '../../../domain/prompt/skill'
import { isEcommerceImageTask } from '../../../domain/agent/ecommerceIntent'
import {
  MAX_AGENT_SKILLS_PER_TURN,
  resolveAgentSkillsForTurn,
  type AgentRequestMode,
} from './agentContextPolicy'

interface SkillProfile {
  textSignal: RegExp
  skillTerms: readonly string[]
}

const PROFILES: readonly SkillProfile[] = [
  {
    textSignal: /电商|淘宝|天猫|京东|拼多多|抖音商城|亚马逊|主图|套图|详情页|白底图|卖点图|商品图/i,
    skillTerms: ['电商', '商品套图', '主图', '详情页', '卖点', '产品'],
  },
  {
    textSignal: /海报|封面|banner|kv|主视觉|宣传图/i,
    skillTerms: ['海报', '主视觉', 'kv', 'banner'],
  },
  {
    textSignal: /包装|礼盒|瓶标|标签|外盒|袋型|刀模/i,
    skillTerms: ['包装', '礼盒', '标签', '结构'],
  },
  {
    textSignal: /视频|tvc|广告片|分镜|运镜|镜头|口播/i,
    skillTerms: ['视频', 'tvc', '分镜', '镜头', '运镜'],
  },
  {
    textSignal: /logo|标志|字标|品牌标识/i,
    skillTerms: ['logo', '标志', '字标', '品牌标识'],
  },
  {
    textSignal: /详情页|卖点|商品文案|产品文案/i,
    skillTerms: ['详情页', '卖点', '商品文案', '产品文案'],
  },
]

function haystackOf(skill: Skill): string {
  return [
    skill.name,
    skill.description,
    ...skill.tags,
    skill.content.slice(0, 1600),
  ].join(' ').toLowerCase()
}

function scoreSkill(skill: Skill, text: string): number {
  const source = text.toLowerCase()
  const haystack = haystackOf(skill)
  let score = 0
  for (const profile of PROFILES) {
    if (!profile.textSignal.test(text)) continue
    for (const term of profile.skillTerms) {
      if (haystack.includes(term.toLowerCase())) score += 4
    }
  }
  for (const term of ['电商', '主图', '详情页', '海报', '包装', '视频', 'skill', '技能']) {
    if (source.includes(term.toLowerCase()) && haystack.includes(term.toLowerCase())) score += 1
  }
  if ('source' in skill && skill.source === 'builtin') score += 0.25
  return score
}

/**
 * 本轮 Skill：显式 chip 永远优先；没有 chip 时，从用户库里按任务意图做一次确定性匹配。
 *
 * 这一步不依赖模型“想起来 SearchSkill”，也不会因为会话里残留的旧 skillId 自动注入。
 * 用户说“用合适的 Skill”时，实际加载哪一个由本轮正文与技能名称 / 说明 / 标签共同决定。
 */
export function chooseAgentSkillsForTurn(input: {
  skills: readonly Skill[]
  text: string
  chipIds?: readonly string[]
  selectedSkillId?: string
  requestMode: AgentRequestMode
  max?: number
}): Skill[] {
  const explicitIds = resolveAgentSkillsForTurn(
    input.chipIds ?? [],
    input.selectedSkillId,
    input.max ?? MAX_AGENT_SKILLS_PER_TURN,
  )
  const byId = new Map(input.skills.map((skill) => [skill.id, skill]))
  if (explicitIds.length > 0) {
    return explicitIds
      .map((id) => byId.get(id))
      .filter((skill): skill is Skill => Boolean(skill))
  }
  if (input.requestMode === 'canvas_operation') return []

  const ecommerce = isEcommerceImageTask(input.text)
  const ranked = input.skills
    .map((skill) => ({ skill, score: scoreSkill(skill, input.text) }))
    .filter((row) => row.score >= 5)
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))
  if (ecommerce) {
    const ecommerceSkill = ranked.find((row) =>
      /电商|商品套图|主图|详情页/.test(`${row.skill.name} ${row.skill.description} ${row.skill.tags.join(' ')}`),
    )
    if (ecommerceSkill) return [ecommerceSkill.skill]
  }
  return ranked
    .slice(0, Math.max(1, Math.min(input.max ?? 1, 2)))
    .map((row) => row.skill)
}

import { describe, expect, it } from 'vitest'
import type { SkillEntity } from '../../../domain/prompt/skill'
import { chooseAgentSkillsForTurn } from './agentSkillSelection'

const skill = (
  id: string,
  name: string,
  description: string,
  tags: string[] = [],
): SkillEntity => ({
  id,
  name,
  description,
  tags,
  content: `${name} ${description}`,
  inputMode: 'any',
  updatedAt: 1,
  source: 'builtin',
})

const skills = [
  skill('builtin:image-ecommerce', '电商产品套图设计与生图', '淘宝京东主图详情页套图与卖点排版', ['电商', '套图']),
  skill('builtin:image-poster', '海报视觉', '活动海报和主视觉设计', ['海报']),
  skill('builtin:tvc-creation', 'TVC 商业广告视频创作流程', '视频分镜与镜头设计', ['视频']),
]

describe('Agent 自动选择 Skill', () => {
  it('★★ 没有 chip 时也能从用户库命中电商 Skill', () => {
    expect(chooseAgentSkillsForTurn({
      skills,
      text: '使用一个合适的 Skill，帮我做淘宝五张主图和详情页',
      requestMode: 'complex_plan',
    }).map((item) => item.id)).toEqual(['builtin:image-ecommerce'])
  })

  it('显式 chip 优先于自动匹配', () => {
    expect(chooseAgentSkillsForTurn({
      skills,
      text: '做一张淘宝主图',
      chipIds: ['builtin:image-poster'],
      requestMode: 'complex_plan',
    }).map((item) => item.id)).toEqual(['builtin:image-poster'])
  })

  it('纯画布操作不自动加载技能', () => {
    expect(chooseAgentSkillsForTurn({
      skills,
      text: '把选中的节点排成一行',
      requestMode: 'canvas_operation',
    })).toEqual([])
  })
})

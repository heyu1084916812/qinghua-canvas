import { describe, expect, it } from 'vitest'
import { kitMentionOptions } from './useAgentKitMentionOptions'
import { mentionIdOf, mentionKindOf, mentionToken, parseMentions, stripMentionMarkup } from '../../text/MentionEditor'
import { sessionKitBindings } from '../../../../state/shared/contextRepository'

const kit = (id: string, name: string, kind: 'brand' | 'role', version: number, updatedAt: number) => ({
  id, name, kind, description: '', currentVersion: version, createdAt: 1, updatedAt,
})

describe('Agent @ 套件', () => {
  it('选项按最近更新排序，value 冻结当前版本', () => {
    expect(kitMentionOptions([kit('k1', '旧', 'brand', 1, 1), kit('k2', '新角色', 'role', 3, 9)])).toEqual([
      { value: 'kit:k2@v3', label: '新角色', hint: '角色 · v3' },
      { value: 'kit:k1@v1', label: '旧', hint: '品牌 · v1' },
    ])
  })

  it('kit chip 能被解析、识别种类，并在发给模型时还原为 @名字', () => {
    const token = mentionToken('kit', 'k2@v3', 'Anbel 品牌')
    expect(token).toBe('@[Anbel 品牌](kit:k2@v3)')
    expect(mentionKindOf(token)).toBe('kit')
    expect(mentionIdOf(token)).toBe('k2@v3')
    expect(parseMentions(`用 ${token} 出图`)).toEqual([{ kind: 'kit', id: 'k2@v3', label: 'Anbel 品牌' }])
    expect(stripMentionMarkup(`用 ${token} 出图`)).toBe('用 @Anbel 品牌 出图')
  })

  it('会话套件覆盖同一套件的项目绑定，其余项目绑定不变', () => {
    const bound = [
      { id: 'b1', projectId: 'p', kitId: 'k1', kitVersion: 1, mode: 'locked' as const, createdAt: 1, updatedAt: 1 },
      { id: 'b2', projectId: 'p', kitId: 'k2', kitVersion: 2, mode: 'locked' as const, createdAt: 1, updatedAt: 1 },
    ]
    const merged = sessionKitBindings('p', bound, [{ kitId: 'k2', version: 5 }, { kitId: 'k3', version: 1 }])
    expect(merged.map((b) => `${b.kitId}@${b.kitVersion}`)).toEqual(['k1@1', 'k2@5', 'k3@1'])
    expect(sessionKitBindings('p', bound, [])).toEqual(bound)
  })
})

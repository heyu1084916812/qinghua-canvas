import { describe, expect, it } from 'vitest'
import {
  channelMenuGeometry,
  nextAllowedCandidatesFor,
  routingCandidatesFor,
  routingChannelGroupsFor,
  selectedRoutingKeysFor,
} from './settingsPageRoutingRules'
import type { Channel } from '../../domain/project/channel'

const channel = (id: string, groups: number): Channel =>
  ({
    id,
    name: `渠道 ${id}`,
    protocol: 'openai-compatible',
    enabled: true,
    hasToken: false,
    credentialGroups: Array.from({ length: groups }, (_, index) => ({
      id: `${id}-g${index}`,
      name: `组 ${index}`,
      hasToken: true,
      priority: 0,
      createdAt: index,
      models: [],
      modelCache: [],
      tokenTail: null,
    })),
  }) as unknown as Channel

describe('设置页选路规则', () => {
  const rows = routingCandidatesFor([channel('a', 2), channel('b', 0)], false)

  it('按启用渠道和凭证组展开候选', () => {
    expect(rows).toHaveLength(3)
    expect(rows[0].key).toBe('a\u0000a-g0')
    expect(rows[2].groupName).toBe('渠道级 Key')
  })

  it('按渠道归并候选且保持来源顺序', () => {
    const groups = routingChannelGroupsFor(rows)
    expect(groups.map((group) => group.candidates.length)).toEqual([2, 1])
  })

  it('空 allowed 表示全选，显式 allowed 只保留仍存在的候选', () => {
    expect(selectedRoutingKeysFor(rows, []).size).toBe(3)
    expect([...selectedRoutingKeysFor(rows, [{ channelId: 'a', credentialGroupId: 'a-g1' }])]).toEqual(['a\u0000a-g1'])
    expect([...selectedRoutingKeysFor(rows, [{ channelId: 'gone' }])]).toEqual([])
  })

  it('不允许清空路由范围；全选仍写成空 allowed', () => {
    expect(nextAllowedCandidatesFor(rows, new Set())).toBeNull()
    expect(nextAllowedCandidatesFor(rows, new Set(rows.map((row) => row.key)))).toEqual([])
    expect(nextAllowedCandidatesFor(rows, new Set(['a\u0000a-g0']))).toEqual([{ channelId: 'a', credentialGroupId: 'a-g0' }])
  })

  it('渠道菜单按视口和确认态夹到可见区域', () => {
    expect(channelMenuGeometry({ x: 5000, y: 5000 }, { width: 1024, height: 700 }, true, false)).toMatchObject({
      width: 184,
      left: 832,
      top: 528,
    })
    expect(channelMenuGeometry(null, { width: 1024, height: 700 }, false, false)).toMatchObject({ left: 0, top: 0 })
  })
})

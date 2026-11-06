import { describe, expect, it, vi } from 'vitest'
import type { Channel } from '../../../domain/project/channel'
import type { RouteCandidateRow } from '../settingsPageRoutingRules'
import {
  createRoutingActions,
  routingPresentationFor,
  toggleRoutingChannelExpanded,
} from './settingsRoutingActions'

const channel = (id: string): Channel =>
  ({
    id,
    name: `渠道 ${id}`,
    protocol: 'openai-compatible',
    enabled: true,
    hasToken: false,
    credentialGroups: [
      {
        id: `${id}-g0`,
        name: '组 0',
        hasToken: true,
        priority: 0,
        createdAt: 0,
        models: [],
        modelCache: [],
      },
    ],
  }) as unknown as Channel

const candidate = (channelId: string, groupId?: string): RouteCandidateRow => ({
  ref: { channelId, ...(groupId ? { credentialGroupId: groupId } : {}) },
  key: `${channelId}\u0000${groupId ?? ''}`,
  channelName: channelId,
  groupName: groupId ?? '渠道级 Key',
  hasToken: true,
  enabled: true,
})

describe('设置页选路动作', () => {
  const rows = [candidate('a', 'g0'), candidate('a', 'g1'), candidate('b')]

  it('由渠道快照派生候选、分组与当前选中 key', () => {
    const presentation = routingPresentationFor(
      [channel('a'), channel('b')],
      false,
      [{ channelId: 'a', credentialGroupId: 'a-g0' }],
    )
    expect(presentation.candidates).toHaveLength(2)
    expect(presentation.groups.map((group) => group.candidates.length)).toEqual([1, 1])
    expect([...presentation.selectedKeys]).toEqual(['a\u0000a-g0'])
  })

  it('空集合与含失效 key 的集合都不写策略', () => {
    const setPolicy = vi.fn()
    const actions = createRoutingActions(rows, new Set(rows.map((row) => row.key)), setPolicy)
    expect(actions.set(new Set())).toBe(false)
    const illegal = createRoutingActions(rows, new Set(['gone']), setPolicy)
    expect(illegal.toggleCandidate('gone', true)).toBe(false)
    expect(illegal.toggleCandidate('missing', false)).toBe(false)
    expect(setPolicy).not.toHaveBeenCalled()
  })

  it('单候选、整组与全选分别生成精确 allowedCandidates', () => {
    const setPolicy = vi.fn()
    createRoutingActions(
      rows,
      new Set(rows.map((row) => row.key)),
      setPolicy,
    ).toggleCandidate(rows[0].key, false)
    expect(setPolicy).toHaveBeenLastCalledWith({
      allowedCandidates: [rows[1].ref, rows[2].ref],
    })

    createRoutingActions(
      rows,
      new Set(rows.map((row) => row.key)),
      setPolicy,
    ).toggleChannel(rows.slice(0, 2), false)
    expect(setPolicy).toHaveBeenLastCalledWith({ allowedCandidates: [rows[2].ref] })

    createRoutingActions(rows, new Set([rows[1].key, rows[2].key]), setPolicy)
      .toggleChannel(rows.slice(0, 1), true)
    expect(setPolicy).toHaveBeenLastCalledWith({ allowedCandidates: [] })
  })

  it('取消最后一项不落空策略，展开集合 toggle 不改原 Set', () => {
    const setPolicy = vi.fn()
    expect(
      createRoutingActions(rows, new Set([rows[2].key]), setPolicy)
        .toggleCandidate(rows[2].key, false),
    ).toBe(false)
    expect(setPolicy).not.toHaveBeenCalled()

    const before = new Set(['a'])
    const after = toggleRoutingChannelExpanded(before, 'b')
    expect(before).toEqual(new Set(['a']))
    expect(after).toEqual(new Set(['a', 'b']))
    expect(toggleRoutingChannelExpanded(after, 'a')).toEqual(new Set(['b']))
  })
})

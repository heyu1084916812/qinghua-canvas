import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import {
  steerMessagesOf,
  type AgentSteer,
} from '../../../../domain/agent/steering'
import { stripMentionMarkup } from '../../text/MentionEditor'
import { toConversation, type ConversationItem } from './conversation'
import {
  buildAssetHashByNode,
  buildConversationItems,
  buildNodeTitles,
  currentTurnHasProcessOf,
  latestProcessIndexOf,
  latestUserIndexOf,
  latestUserStartedAtOf,
  nodeLabelOf,
} from './agentConversationItems'

const user = (createdAt?: number): ConversationItem => ({
  kind: 'user',
  text: '画一张海报',
  ...(createdAt === undefined ? {} : { createdAt }),
})
const text = (): ConversationItem => ({ kind: 'text', text: '好' })
const process = (): ConversationItem => ({ kind: 'process', entries: [] })

const userMessage: ChatMessage = { role: 'user', content: '画一张海报' }
const assistantMessage: ChatMessage = {
  role: 'assistant',
  content: '好的',
}

const steer: AgentSteer = {
  id: 'steer-1',
  text: '再暖一点',
  createdAt: 99,
}

describe('buildNodeTitles', () => {
  it('空图给空 Map', () => {
    expect(buildNodeTitles({ nodes: [] }).size).toBe(0)
  })

  it('标题 trim；空 / null 标题回落「未命名节点」', () => {
    const titles = buildNodeTitles({
      nodes: [
        { id: 'n1', title: '  海报  ' },
        { id: 'n2', title: '   ' },
        { id: 'n3', title: null },
        { id: 'n4' },
      ],
    })

    expect(titles.get('n1')).toBe('海报')
    expect(titles.get('n2')).toBe('未命名节点')
    expect(titles.get('n3')).toBe('未命名节点')
    expect(titles.get('n4')).toBe('未命名节点')
    expect([...titles.keys()]).toEqual(['n1', 'n2', 'n3', 'n4'])
  })
})

describe('buildConversationItems', () => {
  it('空消息 + 空引导 → 空列表', () => {
    expect(
      buildConversationItems({ messages: [], pendingSteers: [] }),
    ).toEqual([])
  })

  it('单条用户消息 → 一条 user 条目', () => {
    const items = buildConversationItems({
      messages: [userMessage],
      pendingSteers: [],
    })

    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('user')
  })

  it('待发送引导追加在最后（顺序与进入模型一致）', () => {
    const items = buildConversationItems({
      messages: [userMessage, assistantMessage],
      pendingSteers: [steer],
    })

    const last = items[items.length - 1]!
    expect(last.kind).toBe('user')
    expect(last.kind === 'user' ? last.text.trim() : '').toBe('再暖一点')
    // 引导不是插到历史中间
    expect(items[0]!.kind).toBe('user')
  })

  it('拼接规则与直接调 toConversation 完全等价（钉住顺序，防把 steer 放前面）', () => {
    const items = buildConversationItems({
      messages: [userMessage, assistantMessage],
      pendingSteers: [steer],
    })
    const expected = toConversation(
      [...[userMessage, assistantMessage], ...steerMessagesOf([steer], stripMentionMarkup)],
    )

    expect(items).toEqual(expected)
  })

  it('nodeTitles 透传给 toConversation：过程文本里的节点 id 换成标题', () => {
    const items = buildConversationItems({
      messages: [
        {
          role: 'assistant',
          content: '看看 node-1 这张',
          toolCalls: [
            { id: 'call-1', name: 'node.create', args: '{}' },
          ],
        },
      ],
      pendingSteers: [],
      nodeTitles: new Map([['node-1', '海报']]),
    })

    const serialized = JSON.stringify(items)
    expect(serialized).toContain('海报')
    expect(serialized).not.toContain('node-1')
  })
})

describe('latest* 派生', () => {
  it('空列表：-1 / undefined / -1 / false', () => {
    expect(latestUserIndexOf([])).toBe(-1)
    expect(latestUserStartedAtOf([])).toBeUndefined()
    expect(latestProcessIndexOf([])).toBe(-1)
    expect(currentTurnHasProcessOf([])).toBe(false)
  })

  it('没有用户消息时 userIndex 是 -1，过程块从 0 起算', () => {
    const items = [text(), process()]

    expect(latestUserIndexOf(items)).toBe(-1)
    expect(latestUserStartedAtOf(items)).toBeUndefined()
    expect(latestProcessIndexOf(items)).toBe(1)
    expect(currentTurnHasProcessOf(items)).toBe(true)
  })

  it('单条用户消息取它的下标与时间', () => {
    const items = [user(5), text()]

    expect(latestUserIndexOf(items)).toBe(0)
    expect(latestUserStartedAtOf(items)).toBe(5)
  })

  it('多条用户消息取最后一条；它之前的过程块不算本轮', () => {
    const items = [user(1), process(), text(), user(2), process()]

    expect(latestUserIndexOf(items)).toBe(3)
    expect(latestUserStartedAtOf(items)).toBe(2)
    expect(latestProcessIndexOf(items)).toBe(4)
    expect(currentTurnHasProcessOf(items)).toBe(true)
  })

  it('本轮还没有过程块 → processIndex 停在 -1、hasProcess false', () => {
    const items = [process(), user(1), text()]

    expect(latestProcessIndexOf(items)).toBe(-1)
    expect(currentTurnHasProcessOf(items)).toBe(false)
  })

  it('用户消息没有时间时 startedAt 是 undefined', () => {
    expect(latestUserStartedAtOf([user()])).toBeUndefined()
  })
})

describe('nodeLabelOf', () => {
  it('命中且 trim；未命中或空标题回落「素材」', () => {
    const nodes = [
      { id: 'n1', title: '  海报  ' },
      { id: 'n2', title: '   ' },
    ]

    expect(nodeLabelOf(nodes, 'n1')).toBe('海报')
    expect(nodeLabelOf(nodes, 'n2')).toBe('素材')
    expect(nodeLabelOf(nodes, 'n9')).toBe('素材')
  })
})

describe('buildAssetHashByNode', () => {
  it('空图给空 Map', () => {
    expect(buildAssetHashByNode({ nodes: [] }).size).toBe(0)
  })

  it('只收非空字符串 assetHash，其余节点跳过', () => {
    const map = buildAssetHashByNode({
      nodes: [
        { id: 'n1', data: { assetHash: 'h1' } },
        { id: 'n2', data: { assetHash: '' } },
        { id: 'n3', data: { assetHash: 42 } },
        { id: 'n4' },
        { id: 'n5', data: null },
      ],
    })

    expect([...map.entries()]).toEqual([['n1', 'h1']])
  })

  it('同图同值但不共享实例（不是缓存，重算由宿主 useMemo 决定）', () => {
    const graph = { nodes: [{ id: 'n1', data: { assetHash: 'h1' } }] }

    const first = buildAssetHashByNode(graph)
    const second = buildAssetHashByNode(graph)

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
  })

  it('图变了 → 值跟着变（没有残留旧 hash）', () => {
    const before = buildAssetHashByNode({
      nodes: [{ id: 'n1', data: { assetHash: 'h1' } }],
    })
    const after = buildAssetHashByNode({
      nodes: [{ id: 'n1', data: { assetHash: 'h2' } }],
    })

    expect(before.get('n1')).toBe('h1')
    expect(after.get('n1')).toBe('h2')
  })
})

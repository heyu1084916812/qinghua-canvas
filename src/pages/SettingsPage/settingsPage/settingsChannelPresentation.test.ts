import { describe, expect, it } from 'vitest'
import type { Channel } from '../../../domain/project/channel'
import type { ModelCapability } from '../../../domain/shared/capability'
import {
  activeCredentialGroupFor,
  channelMenuPresentationFor,
  credentialGroupsFor,
  draftModelsFor,
  protocolOptionsFor,
  protocolUsageFor,
  selectedModelGroupsFor,
  visibleChannelsFor,
} from './settingsChannelPresentation'

const channel = (
  id: string,
  overrides: Partial<Channel> = {},
): Channel =>
  ({
    id,
    name: `渠道 ${id}`,
    protocol: 'openai-compatible',
    baseUrl: `https://${id}.example/v1`,
    enabled: true,
    hasToken: true,
    credentialGroups: [
      {
        id: `${id}-g0`,
        name: '组 0',
        priority: 1,
        createdAt: 1,
        hasToken: true,
        models: [],
        modelCache: [],
      },
      {
        id: `${id}-g1`,
        name: '组 1',
        priority: 3,
        createdAt: 0,
        hasToken: true,
        models: [],
        modelCache: [],
      },
    ],
    ...overrides,
  }) as unknown as Channel

const catalog = {
  all: [
    {
      id: 'openai-compatible',
      name: 'OpenAI 兼容',
      short: 'OpenAI',
      family: 'openai',
      kind: 'public',
      status: 'ready',
      note: '兼容说明',
      credentials: [{ key: 'token', label: 'Token' }],
      docUrl: 'https://example.com/token',
    },
    {
      id: 'openai-chat',
      name: '旧对话',
      short: '旧对话',
      family: 'openai',
      kind: 'legacy',
      status: 'ready',
    },
    {
      id: 'pending-protocol',
      name: '待支持',
      short: '待支持',
      family: 'openai',
      kind: 'station',
      status: 'pending',
    },
    {
      id: 'hidden-protocol',
      name: '隐藏',
      short: '隐藏',
      family: 'cli',
      kind: 'hidden',
      status: 'ready',
    },
  ],
} as never

describe('渠道列表与凭证组展示', () => {
  it('按启用状态和协议短名过滤，不改原数组', () => {
    const channels = [
      channel('a', { name: '甲', protocol: 'openai-compatible' }),
      channel('b', { name: '乙', enabled: false }),
    ]
    expect(visibleChannelsFor(channels, 'enabled', '', catalog).map((item) => item.id)).toEqual(['a'])
    expect(visibleChannelsFor(channels, 'disabled', '', catalog).map((item) => item.id)).toEqual(['b'])
    expect(visibleChannelsFor(channels, 'all', 'openai', catalog)).toHaveLength(2)
    expect(channels.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('凭证组按优先级与创建时间排序，并恢复当前组', () => {
    const groups = credentialGroupsFor(channel('a'))
    expect(groups.map((group) => group.id)).toEqual(['a-g1', 'a-g0'])
    expect(activeCredentialGroupFor(groups, 'a-g0')?.id).toBe('a-g0')
    expect(activeCredentialGroupFor(groups, null)?.id).toBe('a-g1')
    expect(credentialGroupsFor(null)).toEqual([])
  })
})

describe('菜单与协议展示', () => {
  it('菜单按视口夹点，并识别内置渠道', () => {
    const presentation = channelMenuPresentationFor(
      [channel('ch_builtin_modelscope')],
      { channelId: 'ch_builtin_modelscope', x: 5000, y: 5000 },
      { width: 1024, height: 700 },
      true,
    )
    expect(presentation).toMatchObject({
      builtin: true,
      width: 184,
      left: 832,
      top: 528,
    })
  })

  it('旧/隐藏协议只保留当前项，pending 单独列出', () => {
    expect(
      protocolOptionsFor({
        catalog,
        currentProtocol: 'openai-chat',
        hiddenBuiltinProtocolIds: new Set(),
      }),
    ).toMatchObject({
      visible: [
        { id: 'openai-compatible' },
        { id: 'openai-chat' },
        { id: 'pending-protocol' },
      ],
      pending: [{ id: 'pending-protocol' }],
    })
  })

  it('协议使用信息来自目录，草稿模型与已选分组按现有规则派生', () => {
    expect(protocolUsageFor('openai-compatible', catalog)).toEqual({
      note: '兼容说明',
      credentials: [{ key: 'token', label: 'Token' }],
      docUrl: 'https://example.com/token',
    })
    const models = [
      { id: 'img', category: 'image', label: '图片', protocol: 'openai-compatible' },
      { id: 'chat', category: 'chat', label: '对话', protocol: 'openai-compatible' },
    ] as unknown as ModelCapability[]
    expect(draftModelsFor(channel('a'), models, 'all', 'img').map((model) => model.id)).toEqual(['img'])
    expect(selectedModelGroupsFor(models).map((group) => group.category)).toEqual(['image', 'chat'])
  })
})

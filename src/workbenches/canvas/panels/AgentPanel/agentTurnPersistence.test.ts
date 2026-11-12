import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../../../platform/memory'
import { createAgentSessionStore } from '../../../../state/agent/sessionStore'
import {
  buildAgentModelMessages,
  composeAgentOutcomeMessages,
  persistAgentUserTurnBeforeRequest,
  persistAgentUserTurnBeforeRoute,
  persistAgentUserTurnForSession,
} from './agentTurnPersistence'
import { modelMessageWindow } from '../../../../domain/agent/modelMessageWindow'

describe('persistAgentUserTurnBeforeRequest', () => {
  it('★★ 阶段事件只留在界面历史，不进入模型消息', () => {
    const messages = buildAgentModelMessages('系统提示', {
      modelWindow: [{
        role: 'assistant',
        content: '',
        phaseEvent: {
          phase: 'referenceAnalysis',
          title: '参考素材分析结束 · 1 项依据',
          evidence: ['r1:u1'],
        },
      }],
      userMessage: { role: 'user', content: '继续做海报' },
      historyMessages: [],
      outcomeTailIndex: 0,
      saved: {} as never,
      messageRevision: 1,
    })
    expect(messages).toEqual([
      { role: 'system', content: '系统提示' },
      { role: 'assistant', content: '' },
      { role: 'user', content: '继续做海报' },
    ])
  })

  it('★★ 在模型请求前落库用户正文与附件引用，取消后仍可恢复', async () => {
    const sessions = createAgentSessionStore(createMemoryPlatform().storage)
    const session = await sessions.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    const abort = new AbortController()

    const persisted = await persistAgentUserTurnBeforeRequest(
      sessions,
      session.id,
      {
        history: [{ role: 'assistant', content: '上一轮回答' }],
        content: '把两张图做成海报',
        display: '把 @[产品图](node:img-1) @[模特图](node:img-2) 做成海报',
        imageNodeIds: ['img-1', 'img-2', 'img-1'],
        now: 10,
      },
    )
    abort.abort()

    expect(abort.signal.aborted).toBe(true)
    expect(persisted.userMessage).toMatchObject({
      role: 'user',
      content: '把两张图做成海报',
      imageNodeIds: ['img-1', 'img-2'],
    })
    expect((await sessions.get(session.id))?.messages).toEqual(
      persisted.historyMessages,
    )
    expect(persisted.messageRevision).toBe(
      persisted.saved.messageRevision,
    )
    expect(persisted.messageRevision).toBeGreaterThan(0)
  })

  it('3/20/200 回读档共用稳定窗口口径，并把窗口外历史留在持久化消息里', async () => {
    const sessions = createAgentSessionStore(createMemoryPlatform().storage)
    const session = await sessions.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    const history = [
      { role: 'user' as const, content: '最初的品牌全案需求' },
      ...Array.from({ length: 210 }, (_, index) => ({
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `历史 ${index}`,
      })),
    ]
    for (const contextWindow of [3, 20, 200]) {
      const persisted = await persistAgentUserTurnBeforeRequest(
        sessions,
        session.id,
        {
          history,
          content: '新请求',
          display: '新请求',
          imageNodeIds: [],
          contextWindow,
          now: 20,
        },
      )
      expect(persisted.modelWindow).toEqual(modelMessageWindow(history, contextWindow))
      expect(persisted.modelWindow.length).toBeLessThanOrEqual(contextWindow)
      expect(persisted.modelWindow[0]?.content).toBe('最初的品牌全案需求')
      expect(persisted.historyMessages).toEqual([...history, persisted.userMessage])
    }
  })

  it('★★ 8/32 步长任务后仍保留原始需求，且发给模型的窗口有界', async () => {
    const sessions = createAgentSessionStore(createMemoryPlatform().storage)
    const session = await sessions.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    for (const steps of [8, 32]) {
      const history = [
        { role: 'user' as const, content: '云岚茶品牌全案：宋韵、青瓷主色、12 页作品集' },
        ...Array.from({ length: steps }, (_, index) => [
          {
            role: 'assistant' as const,
            content: '',
            toolCalls: [{ id: `call-${index}`, name: 'readGraph', args: '{}' }],
          },
          {
            role: 'tool' as const,
            content: `{"ok":true}`,
            toolCallId: `call-${index}`,
            toolName: 'readGraph',
          },
        ]).flat(),
      ]
      const persisted = await persistAgentUserTurnBeforeRequest(sessions, session.id, {
        history,
        content: '继续',
        display: '继续',
        imageNodeIds: [],
        contextWindow: 20,
        now: 21,
      })
      expect(persisted.modelWindow[0]?.content).toContain('云岚茶品牌全案')
      expect(persisted.modelWindow.length).toBeLessThanOrEqual(20)
      expect(persisted.historyMessages).toHaveLength(history.length + 1)
      for (const message of persisted.modelWindow) {
        if (message.role !== 'tool') continue
        expect(persisted.modelWindow.some((item) =>
          item.role === 'assistant' && item.toolCalls?.some((call) => call.id === message.toolCallId),
        )).toBe(true)
      }
    }
  })

  it('发送链窗口与 contextFor 的建议纯函数口径一致；存储事务断言不依赖 UI 历史', async () => {
    const sessions = createAgentSessionStore(createMemoryPlatform().storage)
    const a = await sessions.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    const b = await sessions.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    const longHistory = [
      { role: 'user' as const, content: 'A 的最初需求' },
      ...Array.from({ length: 30 }, (_, index) => ({
        role: 'user' as const,
        content: `A 第 ${index} 条`,
      })),
    ]
    await sessions.saveMessages(a.id, longHistory)
    await sessions.saveMessages(b.id, [{ role: 'user' as const, content: 'B 的最初需求' }])
    const turn = await persistAgentUserTurnForSession(sessions, a.id, {
      content: 'A 继续',
      display: 'A 继续',
      imageNodeIds: [],
      now: 22,
    })
    expect(turn.modelWindow[0]?.content).toBe('A 的最初需求')
    expect(turn.modelWindow).toEqual(modelMessageWindow(longHistory, 20))
    expect((await sessions.messagesFor(b.id)).map((m) => m.content)).toEqual(['B 的最初需求'])
    expect(await sessions.contextFor(a.id, 20)).toHaveLength(20)
  })

  it('★★ 后台发送 B 时只读取 B 自己的历史，不串入界面上的 A', async () => {
    const sessions = createAgentSessionStore(createMemoryPlatform().storage)
    const a = await sessions.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    const b = await sessions.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    await sessions.saveMessages(a.id, [
      { role: 'user', content: 'A 的历史' },
      { role: 'assistant', content: 'A 的回答' },
    ])
    await sessions.saveMessages(b.id, [
      { role: 'user', content: 'B 的历史' },
      { role: 'assistant', content: 'B 的回答' },
    ])

    const persisted = await persistAgentUserTurnForSession(sessions, b.id, {
      content: 'B 的新请求',
      display: 'B 的新请求',
      imageNodeIds: [],
      now: 30,
    })

    expect(persisted.historyMessages.map((message) => message.content)).toEqual([
      'B 的历史',
      'B 的回答',
      'B 的新请求',
    ])
    expect((await sessions.messagesFor(b.id)).map((message) => message.content)).toEqual([
      'B 的历史',
      'B 的回答',
      'B 的新请求',
    ])
    expect((await sessions.messagesFor(a.id)).map((message) => message.content)).toEqual([
      'A 的历史',
      'A 的回答',
    ])
  })

  it('★★ 路由失败时用户消息仍已落库，且不会阻塞后续恢复', async () => {
    const sessions = createAgentSessionStore(createMemoryPlatform().storage)
    const session = await sessions.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    let visibleToRoute: Awaited<ReturnType<typeof sessions.messagesFor>> = []

    const result = await persistAgentUserTurnBeforeRoute(
      sessions,
      session.id,
      {
        content: '请继续修改这张图',
        display: '请继续修改 @[主图](node:img-1)',
        imageNodeIds: ['img-1'],
        now: 40,
      },
      async () => {
        visibleToRoute = await sessions.messagesFor(session.id)
        return { ok: false as const, message: '没有可用渠道' }
      },
    )

    expect(visibleToRoute.at(-1)).toMatchObject({
      role: 'user',
      content: '请继续修改这张图',
      imageNodeIds: ['img-1'],
    })
    expect(result.route).toEqual({
      ok: false,
      message: '没有可用渠道',
    })
    expect((await sessions.messagesFor(session.id)).at(-1)).toMatchObject({
      role: 'user',
      content: '请继续修改这张图',
      imageNodeIds: ['img-1'],
    })
  })

  it('★★ 窗口边界裁掉 orphan tool 时，完整历史和用户消息都不丢', async () => {
    const sessions = createAgentSessionStore(createMemoryPlatform().storage)
    const session = await sessions.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    const history = [
      { role: 'user' as const, content: '旧请求' },
      {
        role: 'assistant' as const,
        content: '',
        toolCalls: [{ id: 'old-call', name: 'readGraph', args: '{}' }],
      },
      {
        role: 'tool' as const,
        content: '{"ok":true}',
        toolCallId: 'old-call',
        toolName: 'readGraph',
      },
      { role: 'assistant' as const, content: '旧回答' },
      { role: 'user' as const, content: '上一句' },
    ]

    const persisted = await persistAgentUserTurnBeforeRequest(
      sessions,
      session.id,
      {
        history,
        content: '本轮新请求',
        display: '本轮新请求',
        imageNodeIds: [],
        contextWindow: 3,
        now: 50,
      },
    )

    expect(persisted.modelWindow.map((message) => message.content)).toEqual([
      '旧请求',
      '旧回答',
      '上一句',
    ])
    expect(
      persisted.historyMessages.some(
        (message) =>
          message.role === 'tool' && message.toolCallId === 'old-call',
      ),
    ).toBe(true)

    const modelMessages = buildAgentModelMessages('系统提示', persisted)
    const outcomeMessages = [
      ...modelMessages,
      { role: 'assistant' as const, content: '本轮回答' },
    ]
    const merged = composeAgentOutcomeMessages(persisted, outcomeMessages)

    expect(merged.map((message) => message.content)).toEqual([
      '旧请求',
      '',
      '{"ok":true}',
      '旧回答',
      '上一句',
      '本轮新请求',
      '本轮回答',
    ])
    expect(
      merged.filter(
        (message) =>
          message.role === 'user' && message.content === '本轮新请求',
      ),
    ).toHaveLength(1)
    expect(
      merged.some(
        (message) =>
          message.role === 'tool' && message.toolCallId === 'old-call',
      ),
    ).toBe(true)
  })

  it('★★ 路由失败后继续同一条未得到回复的用户消息时，不重复追加', async () => {
    const sessions = createAgentSessionStore(createMemoryPlatform().storage)
    const session = await sessions.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    const input = {
      content: '继续做海报',
      display: '继续做海报',
      imageNodeIds: ['img-1'],
    }
    await persistAgentUserTurnBeforeRequest(sessions, session.id, {
      ...input,
      history: [{ role: 'assistant', content: '上一轮回答' }],
      now: 60,
    })

    const retried = await persistAgentUserTurnBeforeRequest(sessions, session.id, {
      ...input,
      history: (await sessions.get(session.id))?.messages ?? [],
      now: 61,
    })

    expect(
      retried.historyMessages.filter((message) => message.role === 'user'),
    ).toHaveLength(1)
    expect((await sessions.get(session.id))?.messages).toEqual(
      retried.historyMessages,
    )
  })
})

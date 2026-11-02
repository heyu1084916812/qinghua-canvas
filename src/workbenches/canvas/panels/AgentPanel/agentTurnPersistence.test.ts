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

describe('persistAgentUserTurnBeforeRequest', () => {
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
  })

  it('保持回读窗口不变，同时把窗口外历史留在持久化消息里', async () => {
    const sessions = createAgentSessionStore(createMemoryPlatform().storage)
    const session = await sessions.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    const history = Array.from({ length: 4 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `历史 ${index}`,
    }))

    const persisted = await persistAgentUserTurnBeforeRequest(
      sessions,
      session.id,
      {
        history,
        content: '新请求',
        display: '新请求',
        imageNodeIds: [],
        contextWindow: 2,
        now: 20,
      },
    )

    expect(persisted.modelWindow.map((message) => message.content)).toEqual([
      '历史 2',
      '历史 3',
    ])
    expect(persisted.historyMessages.map((message) => message.content)).toEqual([
      '历史 0',
      '历史 1',
      '历史 2',
      '历史 3',
      '新请求',
    ])
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

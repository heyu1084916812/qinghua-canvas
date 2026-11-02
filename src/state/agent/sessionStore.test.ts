import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import type { QueuedAgentTurn } from '../../domain/agent/queuedTurn'
import { AGENT_CONTEXT_WINDOW, createAgentSessionStore } from './sessionStore'

/**
 * Agent 会话存储（设计文档 §8 / §12）。
 *
 * 最要紧的两条断言都在「隔离」上：会话按项目过滤、上下文只取自己那一份。
 * 这两处一旦做错，表现是「它知道我没在这个会话里说过的事」—— 很难查，所以钉死。
 */

const store = () => createAgentSessionStore(createMemoryPlatform().storage)

describe('Agent 会话 · 基本 CRUD', () => {
  it('★ 建了能列出来，默认标题与默认模型都带上', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    const list = await s.list('p1')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: a.id, title: '新对话', model: 'm1' })
  })

  it('★ 改名与删除', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.rename(a.id, '做详情页')
    expect((await s.list('p1'))[0]!.title).toBe('做详情页')
    await s.remove(a.id)
    expect(await s.list('p1')).toHaveLength(0)
  })

  /**
   * ★ 图片 / 视频 / 对话**三档模型**都要存得住、读得回（用户 2026-10-03 的三档选择）。
   *
   * 这三档是各存各的：存错字段的表现不是报错，而是「切走再切回，模型自己变回去了」。
   */
  it('★ 图片 / 视频模型与对话模型分开存、都能读回', async () => {
    const s = store()
    const a = await s.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'Agnes 2.5 Pro',
      imageModel: 'Agnes Image 2.5 Flash',
      videoModel: 'Agnes Video 2.5 Flash',
    })
    const row = (await s.list('p1')).find((x) => x.id === a.id)!
    expect(row).toMatchObject({
      model: 'Agnes 2.5 Pro',
      imageModel: 'Agnes Image 2.5 Flash',
      videoModel: 'Agnes Video 2.5 Flash',
    })
  })

  it('★ 新建会话可以直接带入单技能，空值不落库', async () => {
    const s = store()
    const withSkill = await s.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
      skillId: 'skill-1',
    })
    const without = await s.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    const rows = await s.list('p1')
    expect(rows.find((row) => row.id === withSkill.id)?.skillId).toBe('skill-1')
    expect(rows.find((row) => row.id === without.id)?.skillId).toBeUndefined()
  })
})

describe('Agent 会话 · 消息拆表', () => {
  it('列表只读会话元数据，消息稳定写入 agentMessages', async () => {
    const storage = createMemoryPlatform().storage
    const s = createAgentSessionStore(storage)
    const session = await s.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })

    await s.saveMessages(session.id, [
      { role: 'user', content: '第一条' },
      { role: 'assistant', content: '第二条' },
      { role: 'tool', content: '第三条', toolCallId: 'call-1', toolName: 'readGraph' },
    ])

    const sessionRow = (await storage.query('agentSessions', { id: session.id }))[0]
    expect(sessionRow?.messages).toBeUndefined()
    const list = await s.list('p1')
    expect(list[0]?.id).toBe(session.id)
    expect(list[0]?.messages).toEqual([])

    const rows = await storage.query('agentMessages', { sessionId: session.id })
    expect(rows.map((row) => row.sequence)).toEqual([0, 1, 2])
    expect(await s.messagesFor(session.id)).toMatchObject([
      { role: 'user', content: '第一条' },
      { role: 'assistant', content: '第二条' },
      { role: 'tool', content: '第三条', toolName: 'readGraph' },
    ])
    expect((await s.get(session.id))?.messages).toHaveLength(3)
  })

  it('旧会话首次打开时按序迁移，重复创建 store 不会重复消息', async () => {
    const storage = createMemoryPlatform().storage

    // 用真实表名种旧数据，避免测试替身替我们改写形状。
    await storage.put('agentSessions', {
      id: 'chat-old',
      projectId: 'p1',
      title: '旧会话',
      channelId: 'c1',
      model: 'm1',
      queuedTurns: [],
      pendingSteers: [],
      messages: [
        { role: 'user', content: '旧问题' },
        { role: 'assistant', content: '旧回答' },
      ],
      createdAt: 1,
      updatedAt: 2,
    })
    await storage.put('agentSessions', {
      id: 'chat-empty',
      projectId: 'p1',
      title: '空会话',
      channelId: 'c1',
      model: 'm1',
      queuedTurns: [],
      pendingSteers: [],
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    })

    const first = createAgentSessionStore(storage)
    expect(await first.list('p1')).toHaveLength(2)
    expect(await storage.query('agentMessages', { sessionId: 'chat-old' })).toHaveLength(2)
    expect(
      (await storage.query('storageMigrations', {
        id: 'agent-messages.split.v1',
      }))[0],
    ).toMatchObject({
      status: 'complete',
      sessionCount: 2,
      messageCount: 2,
    })
    expect((await storage.query('agentSessions', { id: 'chat-old' }))[0]?.messages)
      .toBeUndefined()

    const reopened = createAgentSessionStore(storage)
    expect((await reopened.get('chat-old'))?.messages).toMatchObject([
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: '旧回答' },
    ])
    expect(await storage.query('agentMessages', { sessionId: 'chat-old' })).toHaveLength(2)
  })

  it('删除会话同时删除消息，字段更新不会丢失正文', async () => {
    const storage = createMemoryPlatform().storage
    const s = createAgentSessionStore(storage)
    const session = await s.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    await s.saveMessages(session.id, [{ role: 'user', content: '保留我' }])

    const updated = await s.updateFields(session.id, { model: 'm2' })
    expect(updated?.messages).toMatchObject([{ role: 'user', content: '保留我' }])

    await s.remove(session.id)
    expect(await storage.query('agentMessages', { sessionId: session.id })).toEqual([])
  })

  it('迁移标记完成后又出现旧式消息时，读取会先补拆表，元数据更新不丢正文', async () => {
    const storage = createMemoryPlatform().storage
    const s = createAgentSessionStore(storage)
    await s.list('p1')
    await storage.put('agentSessions', {
      id: 'chat-late-legacy',
      projectId: 'p1',
      title: '旧字段会话',
      channelId: 'c1',
      model: 'm1',
      queuedTurns: [],
      pendingSteers: [],
      messages: [{ role: 'user', content: '不能丢' }],
      createdAt: 1,
      updatedAt: 2,
    })

    const updated = await s.updateFields('chat-late-legacy', { title: '已更新' })
    expect(updated?.messages).toMatchObject([{ role: 'user', content: '不能丢' }])
    expect(await s.messagesFor('chat-late-legacy')).toMatchObject([
      { role: 'user', content: '不能丢' },
    ])
    expect((await storage.query('agentSessions', { id: 'chat-late-legacy' }))[0]?.messages)
      .toBeUndefined()
  })
})

describe('Agent 会话 · 隔离（最容易出错的地方）', () => {
  it('★★ 会话按项目过滤：A 项目的会话不会出现在 B 项目里', async () => {
    const s = store()
    await s.create({ projectId: 'p1', channelId: 'c', model: 'm' })
    await s.create({ projectId: 'p2', channelId: 'c', model: 'm' })
    expect(await s.list('p1')).toHaveLength(1)
    expect(await s.list('p2')).toHaveLength(1)
  })

  it('★★ 上下文只取当前会话：两个会话各说各的，互不串味', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c', model: 'm' })
    const b = await s.create({ projectId: 'p1', channelId: 'c', model: 'm' })

    await s.save({ ...a, messages: [{ role: 'user', content: 'A 会话说的话' }] })
    await s.save({ ...b, messages: [{ role: 'user', content: 'B 会话说的话' }] })

    const ctxA = await s.contextFor(a.id)
    const ctxB = await s.contextFor(b.id)
    expect(ctxA.map((m) => m.content)).toEqual(['A 会话说的话'])
    expect(ctxB.map((m) => m.content)).toEqual(['B 会话说的话'])
    // 关键：A 的上下文里**不可能**出现 B 说过的话
    expect(JSON.stringify(ctxA)).not.toContain('B 会话')
  })

  it('★★ 上下文窗口从尾部截断：保留最近的，丢掉最早那几条', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c', model: 'm' })
    const many = Array.from({ length: AGENT_CONTEXT_WINDOW + 5 }, (_, i) => ({
      role: 'user' as const,
      content: `第${i}条`,
    }))
    await s.save({ ...a, messages: many })
    const ctx = await s.contextFor(a.id)
    expect(ctx).toHaveLength(AGENT_CONTEXT_WINDOW)
    expect(ctx.at(-1)!.content).toBe(`第${many.length - 1}条`)
    expect(ctx[0]!.content).toBe(`第${many.length - AGENT_CONTEXT_WINDOW}条`)
  })

  /*
   * 「删项目连带删会话」**不在这层测**：那条规则现在只有一处实现 ——
   * `state/project/repository.ts` 的 `PROJECT_CASCADE_TABLES`（删项目的唯一入口）。
   * 会话 store 曾经也有一份 `removeByProject`，两处实现同一件事，
   * 正是「规则写两遍必然漂移」的形状，故删掉那份，断言移去
   * `repository.test.ts`「删项目连执行日志与 Agent 会话一起清」。
   */

  it('★ 会话不存在时上下文是空的（不抛错，也不拿别人的顶上）', async () => {
    const s = store()
    expect(await s.contextFor('nope')).toEqual([])
  })
})

describe('Agent 会话 · 回合版本门禁', () => {
  it('★★ 旧 outcome 使用过期 revision 时必须 conflict，不能覆盖新用户消息', async () => {
    const s = store()
    const a = await s.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    const firstUser = {
      role: 'user' as const,
      content: '旧回合',
    }
    const first = await s.saveMessages(a.id, [firstUser])
    expect(first?.messageRevision).toBe(1)
    await s.enqueueSteer(a.id, {
      id: 'steer-old',
      text: '旧引导',
      createdAt: 1,
    })

    const applied = await s.applyAgentOutcome(a.id, {
      expectedRevision: 1,
      messages: [
        firstUser,
        { role: 'assistant', content: '旧回答' },
      ],
      pendingConfirmation: {
        callId: 'old-call',
        name: 'runNode',
        args: { nodeIds: ['old'] },
      },
      allowedToolNames: ['runNode'],
      removeSteerIds: ['steer-old'],
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok) throw new Error('预期当前 revision 可写')
    expect(applied.session.messageRevision).toBe(2)
    expect(applied.session.pendingSteers).toEqual([])

    const newer = await s.saveMessages(a.id, [
      firstUser,
      { role: 'assistant', content: '旧回答' },
      { role: 'user', content: '新回合不能丢' },
    ])
    expect(newer?.messageRevision).toBe(3)
    await s.updateFields(a.id, {
      pendingConfirmation: {
        callId: 'new-call',
        name: 'runNode',
        args: { nodeIds: ['new'] },
      },
      allowedToolNames: ['readGraph', 'runNode'],
    })

    const stale = await s.applyAgentOutcome(a.id, {
      expectedRevision: 1,
      messages: [firstUser],
      pendingConfirmation: undefined,
      allowedToolNames: undefined,
    })
    expect(stale).toEqual({ ok: false, reason: 'conflict' })
    const current = await s.get(a.id)
    expect(current?.messageRevision).toBe(3)
    expect(current?.messages.at(-1)).toEqual({
      role: 'user',
      content: '新回合不能丢',
    })
    expect(current?.pendingConfirmation?.callId).toBe('new-call')
    expect(current?.allowedToolNames).toEqual([
      'readGraph',
      'runNode',
    ])
  })

  it('★ 无确认卡的 stop 仍清检查点，不拿旧 React 消息覆盖历史', async () => {
    const s = store()
    const a = await s.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    const saved = await s.saveMessages(a.id, [
      { role: 'user', content: '暂停中的任务' },
    ])
    await s.updateFields(a.id, {
      continuation: {
        reason: 'max_steps',
        maxSteps: 8,
        createdAt: 1,
      },
      allowedToolNames: ['readGraph', 'runNode'],
    })

    const staleStop = await s.settleInterruptedSession(
      a.id,
      undefined,
      'interrupted',
      (saved?.messageRevision ?? 0) - 1,
    )
    expect(staleStop?.messageRevision).toBe(saved?.messageRevision)
    expect(staleStop?.continuation?.createdAt).toBe(1)

    const stopped = await s.settleInterruptedSession(
      a.id,
      undefined,
      'interrupted',
      saved?.messageRevision,
    )
    expect(stopped?.messages).toEqual(saved?.messages)
    expect(stopped?.messageRevision).toBe(
      (saved?.messageRevision ?? 0) + 1,
    )
    expect(stopped?.continuation).toBeUndefined()
    expect(stopped?.allowedToolNames).toBeUndefined()

    const late = await s.applyAgentOutcome(a.id, {
      expectedRevision: saved?.messageRevision,
      messages: [
        { role: 'user', content: '停止后迟到的旧回答' },
      ],
    })
    expect(late).toEqual({ ok: false, reason: 'conflict' })
    expect((await s.get(a.id))?.messages).toEqual(saved?.messages)
  })

  it('★★ 迟到 stop 只补旧工具批次，不清新回合确认卡', async () => {
    const s = store()
    const a = await s.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    await s.saveMessages(a.id, [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'old-call',
            name: 'runNode',
            args: '{"nodeIds":["old"]}',
          },
        ],
      },
      { role: 'user', content: '新回合' },
    ])
    await s.updateFields(a.id, {
      pendingConfirmation: {
        callId: 'new-call',
        name: 'deleteNodes',
        args: { nodeIds: ['new'] },
      },
      continuation: {
        reason: 'max_steps',
        maxSteps: 8,
        createdAt: 2,
      },
      allowedToolNames: ['deleteNodes'],
    })

    const settled = await s.settleInterruptedSession(
      a.id,
      { callId: 'old-call', name: 'runNode' },
      'interrupted',
    )
    expect(settled?.messages.map((message) => message.role)).toEqual([
      'assistant',
      'tool',
      'user',
    ])
    expect(settled?.messages[1]).toMatchObject({
      role: 'tool',
      toolCallId: 'old-call',
    })
    expect(settled?.pendingConfirmation?.callId).toBe('new-call')
    expect(settled?.continuation?.createdAt).toBe(2)
    expect(settled?.allowedToolNames).toEqual(['deleteNodes'])
  })
})

describe('Agent 会话 · 待执行任务队列', () => {
  const turn = (id: string, text = `任务 ${id}`): QueuedAgentTurn => ({
    id,
    text,
    createdAt: Number(id),
    channelId: 'channel-a',
    model: 'chat-a',
  })

  it('队列随会话落库，切走或重开仍能读回', async () => {
    const storage = createMemoryPlatform().storage
    const s = createAgentSessionStore(storage)
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    const queued = await s.enqueueTurn(a.id, turn('1'))
    expect(queued.ok).toBe(true)

    const reopened = createAgentSessionStore(storage)
    expect((await reopened.get(a.id))?.queuedTurns.map((item) => item.id)).toEqual(['1'])
  })

  it('排队消息可就地编辑，顺序与冻结模型不变', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.enqueueTurn(a.id, turn('1', '旧文案'))
    await s.enqueueTurn(a.id, turn('2'))
    const next = await s.updateQueuedTurnText(a.id, '1', '  新文案  ')
    expect(next?.queuedTurns.map((item) => [item.id, item.text])).toEqual([
      ['1', '新文案'],
      ['2', '任务 2'],
    ])
    expect(next?.queuedTurns[0]?.model).toBe('chat-a')
  })

  it('普通排队消息可原子转为引导；带新素材的项拒绝', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.enqueueTurn(a.id, turn('1', '改成横版'))
    const promoted = await s.promoteQueuedTurnToSteer(a.id, '1', 'steer-1')
    expect(promoted).toMatchObject({ ok: true })
    if (!promoted.ok) return
    expect(promoted.session.queuedTurns).toEqual([])
    expect(promoted.session.pendingSteers).toEqual([
      { id: 'steer-1', text: '改成横版', createdAt: expect.any(Number) },
    ])

    await s.save({ ...a, pendingAssetIds: ['asset-1'] })
    await s.enqueueTurn(a.id, {
      ...turn('2', '带图修改'),
      pendingAssetIds: ['asset-1'],
    })
    expect(
      await s.promoteQueuedTurnToSteer(a.id, '2', 'steer-2'),
    ).toEqual({ ok: false, reason: 'has_assets' })
  })

  it('★★ 排队时冻结并消费附件，连续排队不会重复携带', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.save({ ...a, pendingAssetIds: ['asset-a', 'asset-b'] })

    const first = await s.enqueueTurn(a.id, {
      ...turn('1'),
      pendingAssetIds: ['asset-a', 'asset-b'],
    })
    expect(first).toMatchObject({
      ok: true,
      session: {
        pendingAssetIds: undefined,
        queuedTurns: [
          expect.objectContaining({ pendingAssetIds: ['asset-a', 'asset-b'] }),
        ],
      },
    })

    const second = await s.enqueueTurn(a.id, {
      ...turn('2'),
      pendingAssetIds: ['asset-a', 'asset-b'],
    })
    expect(second).toMatchObject({
      ok: true,
      session: {
        queuedTurns: [
          expect.objectContaining({ pendingAssetIds: ['asset-a', 'asset-b'] }),
          expect.not.objectContaining({ pendingAssetIds: expect.anything() }),
        ],
      },
    })
    expect((await s.get(a.id))?.pendingAssetIds).toBeUndefined()
  })

  it('★ 有确认卡时不允许把排队消息写成下一步引导', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.enqueueTurn(a.id, turn('1', '我要粗野风'))
    await s.updateFields(a.id, {
      pendingConfirmation: {
        callId: 'call-1',
        name: 'proposeTaskPlan',
        args: {},
      },
    })

    expect(
      await s.promoteQueuedTurnToSteer(a.id, '1', 'steer-1'),
    ).toEqual({ ok: false, reason: 'awaiting_confirmation' })
    const reopened = await s.get(a.id)
    expect(reopened?.pendingSteers).toEqual([])
    expect(reopened?.queuedTurns.map((item) => item.id)).toEqual(['1'])
  })

  it('★★ 旧版确认卡与引导并存时恢复成排队消息并补齐工具结果', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.saveMessages(a.id, [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'proposeTaskPlan', args: '{}' }],
      },
    ])
    await s.enqueueSteer(a.id, { id: 'steer-1', text: '我要粗野风', createdAt: 1 })
    await s.updateFields(a.id, {
      pendingConfirmation: {
        callId: 'call-1',
        name: 'proposeTaskPlan',
        args: {},
      },
    })

    const repaired = await s.repairConfirmationSteerCollision(a.id)
    expect(repaired?.pendingConfirmation).toBeUndefined()
    expect(repaired?.pendingSteers).toEqual([])
    expect(repaired?.queuedTurns).toMatchObject([
      {
        id: 'recovered-steer-1',
        text: '我要粗野风',
        channelId: 'c1',
        model: 'm1',
      },
    ])
    expect(repaired?.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'call-1',
      toolName: 'proposeTaskPlan',
    })
    expect(repaired?.messages.at(-1)?.content).toContain('"canceled":true')
    expect(await s.repairConfirmationSteerCollision(a.id)).toBeNull()

    // The same repair is all-or-nothing when recovery cannot fit every steer in the queue.
    {
      const overflow = store()
      const overflowSession = await overflow.create({
        projectId: 'p1',
        channelId: 'c1',
        model: 'm1',
      })
      for (let i = 0; i < 20; i += 1) {
        await overflow.enqueueTurn(
          overflowSession.id,
          turn(String(i), `queued ${i}`),
        )
      }
      await overflow.enqueueSteer(overflowSession.id, {
        id: 'steer-overflow',
        text: 'keep me',
        createdAt: 21,
      })
      await overflow.updateFields(overflowSession.id, {
        pendingConfirmation: {
          callId: 'call-overflow',
          name: 'proposeTaskPlan',
          args: {},
        },
      })

      const recovered = await overflow.repairConfirmationSteerCollision(
        overflowSession.id,
      )
      expect(recovered).toBeNull()
      const untouched = await overflow.get(overflowSession.id)
      expect(untouched?.pendingConfirmation?.callId).toBe('call-overflow')
      expect(untouched?.queuedTurns).toHaveLength(20)
      expect(untouched?.pendingSteers).toMatchObject([
        { id: 'steer-overflow', text: 'keep me' },
      ])
    }
  })

  it('★★ 消息写回只更新 messages，不会把运行中后来入队的任务整行覆盖掉', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    const queued = await s.enqueueTurn(a.id, turn('1'))
    expect(queued.ok).toBe(true)

    const saved = await s.saveMessages(a.id, [{ role: 'user', content: '正在执行的回合' }])
    expect(saved?.messages.map((message) => message.content)).toEqual(['正在执行的回合'])
    expect(saved?.queuedTurns.map((item) => item.id)).toEqual(['1'])
  })

  it('★★ 模型请求前落库的用户消息在回合中断后仍可恢复，且保留附件引用', async () => {
    const storage = createMemoryPlatform().storage
    const s = createAgentSessionStore(storage)
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    const pendingMessages = [
      { role: 'assistant' as const, content: '上一轮回答' },
      {
        role: 'user' as const,
        content: '把这两张图做成海报',
        display: '把 @[产品图](node:img-1) @[模特图](node:img-2) 做成海报',
        createdAt: 10,
        imageNodeIds: ['img-1', 'img-2'],
      },
    ]

    await s.saveMessages(a.id, pendingMessages)
    await s.updateFields(a.id, {
      pendingConfirmation: undefined,
      continuation: undefined,
      activeTurnId: undefined,
    })

    const reopened = createAgentSessionStore(storage)
    const recovered = await reopened.get(a.id)
    expect(recovered?.messages).toEqual(pendingMessages)
    expect(recovered?.messages.at(-1)).toMatchObject({
      role: 'user',
      content: '把这两张图做成海报',
      imageNodeIds: ['img-1', 'img-2'],
    })
  })

  it('FIFO 原子领取队首；完成前任务仍在库里', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.enqueueTurn(a.id, turn('1'))
    await s.enqueueTurn(a.id, turn('2'))
    await s.enqueueTurn(a.id, turn('3'))

    await s.removeQueuedTurn(a.id, '2')
    const first = await s.claimNextQueuedTurn(a.id)
    expect(first?.turn.id).toBe('1')
    expect(first?.session.activeTurnId).toBe('1')
    expect(first?.session.queuedTurns.map((item) => item.id)).toEqual(['1', '3'])
    expect(await s.claimNextQueuedTurn(a.id)).toBeNull()

    const kept = await s.finishActiveQueuedTurn(a.id, '1', false)
    expect(kept?.queuedTurns.map((item) => item.id)).toEqual(['1', '3'])
    expect(kept?.activeTurnId).toBeUndefined()

    const again = await s.claimNextQueuedTurn(a.id)
    expect(again?.turn.id).toBe('1')
    const completed = await s.finishActiveQueuedTurn(a.id, '1', true)
    expect(completed?.queuedTurns.map((item) => item.id)).toEqual(['3'])
    expect((await s.claimNextQueuedTurn(a.id))?.turn.id).toBe('3')
  })

  it('后台回合只清理已发送的素材引用，不误删运行中后来附加的素材', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.save({ ...a, pendingAssetIds: ['sent', 'new'] })
    const next = await s.clearPendingAssetIds(a.id, ['sent'])
    expect(next?.pendingAssetIds).toEqual(['new'])
  })

  it('★★ 字段级更新不会用旧 UI 快照覆盖消息和队列', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.enqueueTurn(a.id, turn('1'))
    await s.saveMessages(a.id, [{ role: 'user', content: '已存在消息' }])

    const next = await s.updateFields(a.id, { model: 'm2', imageModel: 'image-2' })
    expect(next).toMatchObject({
      model: 'm2',
      imageModel: 'image-2',
      messages: [{ role: 'user', content: '已存在消息' }],
    })
    expect(next?.queuedTurns.map((item) => item.id)).toEqual(['1'])
  })

  it('进程中断恢复只释放活动标记，队首任务仍保留', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.enqueueTurn(a.id, turn('1'))
    const claimed = await s.claimNextQueuedTurn(a.id)
    expect(claimed?.session.activeTurnId).toBe('1')

    const recovered = await s.releaseActiveTurn(a.id)
    expect(recovered?.activeTurnId).toBeUndefined()
    expect(recovered?.queuedTurns.map((item) => item.id)).toEqual(['1'])
    expect((await s.claimNextQueuedTurn(a.id))?.turn.id).toBe('1')
  })

  it('待确认工具调用随会话读回，恢复后仍能重新生成确认卡', async () => {
    const storage = createMemoryPlatform().storage
    const s = createAgentSessionStore(storage)
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.updateFields(a.id, {
      pendingConfirmation: { callId: 'call-1', name: 'runNode', args: { nodeIds: ['n1'] } },
      allowedToolNames: ['readGraph', 'applyPlan', 'runNode', 'readResult'],
    })
    const reopened = createAgentSessionStore(storage)
    expect((await reopened.get(a.id))?.pendingConfirmation).toEqual({
      callId: 'call-1',
      name: 'runNode',
      args: { nodeIds: ['n1'] },
    })
    expect((await reopened.get(a.id))?.allowedToolNames).toEqual([
      'readGraph',
      'applyPlan',
      'runNode',
      'readResult',
    ])
  })

  it('用户停止后清掉确认卡和检查点，重开不会复活旧任务', async () => {
    const storage = createMemoryPlatform().storage
    const s = createAgentSessionStore(storage)
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.updateFields(a.id, {
      pendingConfirmation: {
        callId: 'call-1',
        name: 'runNode',
        args: { nodeIds: ['n1'] },
      },
      continuation: {
        reason: 'max_steps',
        maxSteps: 8,
        createdAt: 1,
      },
      allowedToolNames: ['readGraph', 'applyPlan', 'runNode', 'readResult'],
    })

    await s.updateFields(a.id, {
      pendingConfirmation: undefined,
      continuation: undefined,
      allowedToolNames: undefined,
    })

    const reopened = createAgentSessionStore(storage)
    expect((await reopened.get(a.id))?.pendingConfirmation).toBeUndefined()
    expect((await reopened.get(a.id))?.continuation).toBeUndefined()
    expect((await reopened.get(a.id))?.allowedToolNames).toBeUndefined()
  })

  it('★★ 迟到确认按最新历史原子补 interrupted，并只清同一个 callId', async () => {
    const s = store()
    const a = await s.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    await s.saveMessages(a.id, [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call-old',
            name: 'deleteNodes',
            args: '{"nodeIds":["n1"]}',
          },
          {
            id: 'call-later',
            name: 'runNode',
            args: '{"nodeIds":["n1"]}',
          },
        ],
      },
    ])
    await s.updateFields(a.id, {
      pendingConfirmation: {
        callId: 'call-old',
        name: 'deleteNodes',
        args: { nodeIds: ['n1'] },
      },
      continuation: {
        reason: 'max_steps',
        maxSteps: 8,
        createdAt: 1,
      },
      allowedToolNames: ['deleteNodes', 'runNode'],
    })

    const settled = await s.settleInterruptedConfirmation(a.id, {
      callId: 'call-old',
      name: 'deleteNodes',
    })
    expect(settled?.pendingConfirmation).toBeUndefined()
    expect(settled?.continuation).toBeUndefined()
    expect(settled?.allowedToolNames).toBeUndefined()
    expect(settled?.messages.slice(1)).toMatchObject([
      {
        role: 'tool',
        toolCallId: 'call-old',
        toolName: 'deleteNodes',
      },
      {
        role: 'tool',
        toolCallId: 'call-later',
        toolName: 'runNode',
      },
    ])
    expect(settled?.messages[1]?.content).toContain(
      '"interrupted":true',
    )
    expect(settled?.messages[2]?.content).toContain(
      '"notStarted":true',
    )

    const again = await s.settleInterruptedConfirmation(a.id, {
      callId: 'call-old',
      name: 'deleteNodes',
    })
    expect(again?.messages).toHaveLength(3)
  })

  it('★★ 旧确认迟到时不得清掉新回合的确认卡与工具白名单', async () => {
    const s = store()
    const a = await s.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    await s.saveMessages(a.id, [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call-old',
            name: 'deleteNodes',
            args: '{"nodeIds":["old"]}',
          },
        ],
      },
      { role: 'user', content: '新回合' },
    ])
    await s.updateFields(a.id, {
      pendingConfirmation: {
        callId: 'call-new',
        name: 'runNode',
        args: { nodeIds: ['new'] },
      },
      continuation: {
        reason: 'max_steps',
        maxSteps: 8,
        createdAt: 2,
      },
      allowedToolNames: ['readGraph', 'runNode'],
    })

    const settled = await s.settleInterruptedConfirmation(a.id, {
      callId: 'call-old',
      name: 'deleteNodes',
    })
    expect(settled?.messages[1]).toMatchObject({
      role: 'tool',
      toolCallId: 'call-old',
      toolName: 'deleteNodes',
    })
    expect(settled?.messages[2]).toEqual({
      role: 'user',
      content: '新回合',
    })
    expect(settled?.pendingConfirmation).toEqual({
      callId: 'call-new',
      name: 'runNode',
      args: { nodeIds: ['new'] },
    })
    expect(settled?.continuation?.createdAt).toBe(2)
    expect(settled?.allowedToolNames).toEqual([
      'readGraph',
      'runNode',
    ])
  })

  it('任务计划随会话持久化，重开后仍是同一个当前步骤', async () => {
    const storage = createMemoryPlatform().storage
    const s = createAgentSessionStore(storage)
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.updateFields(a.id, {
      taskPlan: {
        id: 'plan-1',
        title: '品牌套件',
        steps: [
          { id: 'research', title: '整理品牌输入', status: 'done' },
          { id: 'system', title: '建立视觉规范', status: 'in_progress' },
          { id: 'deliver', title: '生成应用物料', status: 'pending' },
        ],
        currentStepId: 'system',
        createdAt: 1,
        updatedAt: 2,
      },
    })

    const reopened = createAgentSessionStore(storage)
    expect((await reopened.get(a.id))?.taskPlan).toMatchObject({
      id: 'plan-1',
      currentStepId: 'system',
      steps: [
        { id: 'research', status: 'done' },
        { id: 'system', status: 'in_progress' },
        { id: 'deliver', status: 'pending' },
      ],
    })
  })

  it('★ 长任务检查点随会话读回，并保留原来的队列项 id', async () => {
    const storage = createMemoryPlatform().storage
    const s = createAgentSessionStore(storage)
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.updateFields(a.id, {
      continuation: {
        reason: 'max_steps',
        maxSteps: 8,
        createdAt: 123,
        queuedTurnId: 'turn-1',
      },
    })

    const reopened = createAgentSessionStore(storage)
    expect((await reopened.get(a.id))?.continuation).toEqual({
      reason: 'max_steps',
      maxSteps: 8,
      createdAt: 123,
      queuedTurnId: 'turn-1',
    })
  })

  it('★ 运行中引导随会话落库，应用后只删除已应用的条目', async () => {
    const storage = createMemoryPlatform().storage
    const s = createAgentSessionStore(storage)
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.enqueueSteer(a.id, {
      id: 'steer-1',
      text: '改成横版',
      createdAt: 1,
    })
    await s.enqueueSteer(a.id, {
      id: 'steer-2',
      text: '文字再大一点',
      createdAt: 2,
    })

    const reopened = createAgentSessionStore(storage)
    expect((await reopened.get(a.id))?.pendingSteers.map((item) => item.id)).toEqual([
      'steer-1',
      'steer-2',
    ])
    const cleaned = await reopened.removeSteers(a.id, ['steer-1'])
    expect(cleaned?.pendingSteers.map((item) => item.id)).toEqual(['steer-2'])
  })

  it('★ 删除会话同时清理 AgentJob 与事件，不留孤立任务', async () => {
    const storage = createMemoryPlatform().storage
    const s = createAgentSessionStore(storage)
    const session = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await storage.put('agentJobs', {
      id: 'job-1',
      sessionId: session.id,
      projectId: 'p1',
      turnId: 'turn-1',
      status: 'completed',
    })
    await storage.put('agentEvents', {
      id: 'event-1',
      jobId: 'job-1',
      sessionId: session.id,
      projectId: 'p1',
      seq: 1,
      type: 'created',
    })

    await s.remove(session.id)
    expect(await storage.query('agentJobs', { sessionId: session.id })).toEqual([])
    expect(await storage.query('agentEvents', { sessionId: session.id })).toEqual([])
  })
})

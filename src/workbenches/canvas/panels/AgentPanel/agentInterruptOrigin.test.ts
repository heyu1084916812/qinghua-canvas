import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentToolRequest } from '../../agent/agentLoop'
import {
  clearTurnRefs,
  interruptOriginFor,
  type AgentTurnOriginLookup,
  type AgentTurnRefMaps,
} from './agentInterruptOrigin'

function session(id = 's1', messageRevision?: number): AgentSession {
  return {
    id,
    projectId: 'p1',
    title: `会话 ${id}`,
    channelId: '',
    model: 'GPT-6 Astra',
    messages: [],
    pendingSteers: [],
    queuedTurns: [],
    createdAt: 1,
    updatedAt: 1,
    ...(messageRevision === undefined ? {} : { messageRevision }),
  }
}

function emptyMaps() {
  return {
    currentTurnJobId: { current: new Map<string, string>() },
    currentTurnId: { current: new Map<string, string>() },
    currentTurnRevision: { current: new Map<string, number>() },
  }
}

function controller(lookup: {
  jobId?: string
  turnId?: string
} = {}): AgentTurnOriginLookup {
  return {
    jobId: vi.fn(() => lookup.jobId),
    turnId: vi.fn(() => lookup.turnId),
  }
}

describe('interruptOriginFor / 四个 origin 组合', () => {
  it('① 队列回合：queueTurnId 压过一切，jobId 走本轮 ref', () => {
    const refs = emptyMaps()
    refs.currentTurnJobId.current.set('s1', 'job-ref')
    refs.currentTurnId.current.set('s1', 'turn-ref')

    const origin = interruptOriginFor({
      session: session('s1'),
      refs,
      controller: controller({ jobId: 'job-ctl', turnId: 'turn-ctl' }),
      activeQueueTurnOf: () => 'queue-1',
    })

    expect(origin).toEqual({
      jobId: 'job-ref',
      turnId: 'queue-1',
      queueTurnId: 'queue-1',
      messageRevision: undefined,
    })
  })

  it('② 直接回合：没有队列回合时 turnId 用本轮 ref', () => {
    const refs = emptyMaps()
    refs.currentTurnId.current.set('s1', 'turn-ref')

    const origin = interruptOriginFor({
      session: session('s1'),
      refs,
      controller: controller({ jobId: 'job-ctl', turnId: 'turn-ctl' }),
      activeQueueTurnOf: () => undefined,
    })

    expect(origin).toEqual({
      jobId: 'job-ctl',
      turnId: 'turn-ref',
      queueTurnId: undefined,
      messageRevision: undefined,
    })
  })

  it('③ 冷启动/已清理：refs 全空时回退 controller', () => {
    const origin = interruptOriginFor({
      session: session('s1'),
      refs: emptyMaps(),
      controller: controller({ jobId: 'job-ctl', turnId: 'turn-ctl' }),
      activeQueueTurnOf: () => undefined,
    })

    expect(origin).toEqual({
      jobId: 'job-ctl',
      turnId: 'turn-ctl',
      queueTurnId: undefined,
      messageRevision: undefined,
    })
  })

  it('④ revision：会话上的持久值优先于本轮 ref，都没有才是 undefined', () => {
    const refs = emptyMaps()
    refs.currentTurnRevision.current.set('s1', 7)

    const fromRef = interruptOriginFor({
      session: session('s1'),
      refs,
      controller: controller(),
      activeQueueTurnOf: () => undefined,
    })
    expect(fromRef.messageRevision).toBe(7)

    const fromSession = interruptOriginFor({
      session: session('s1', 12),
      refs,
      controller: controller(),
      activeQueueTurnOf: () => undefined,
    })
    expect(fromSession.messageRevision).toBe(12)

    const neither = interruptOriginFor({
      session: session('s1'),
      refs: emptyMaps(),
      controller: controller(),
      activeQueueTurnOf: () => undefined,
    })
    expect(neither.messageRevision).toBeUndefined()
  })

  it('只读目标会话自己的 refs，不串味', () => {
    const refs = emptyMaps()
    refs.currentTurnJobId.current.set('s2', 'job-b')
    refs.currentTurnId.current.set('s2', 'turn-b')

    const origin = interruptOriginFor({
      session: session('s1'),
      refs,
      controller: controller({ jobId: 'job-ctl', turnId: 'turn-ctl' }),
      activeQueueTurnOf: () => undefined,
    })

    expect(origin.jobId).toBe('job-ctl')
    expect(origin.turnId).toBe('turn-ctl')
  })
})

describe('clearTurnRefs / 六张 per-session 表', () => {
  function fullRefs(): AgentTurnRefMaps {
    const request: AgentToolRequest = {
      callId: 'call-1',
      name: 'node.delete',
      args: {},
    }
    const refs: AgentTurnRefMaps = {
      abort: { current: new Map<string, AbortController>() },
      deliveredSteers: { current: new Map<string, Set<string>>() },
      inFlightConfirmation: { current: new Map<string, AgentToolRequest>() },
      currentTurnId: { current: new Map<string, string>() },
      currentTurnJobId: { current: new Map<string, string>() },
      currentTurnRevision: { current: new Map<string, number>() },
    }
    refs.abort.current.set('s1', new AbortController())
    refs.deliveredSteers.current.set('s1', new Set(['steer-1']))
    refs.inFlightConfirmation.current.set('s1', request)
    refs.currentTurnId.current.set('s1', 'turn-1')
    refs.currentTurnJobId.current.set('s1', 'job-1')
    refs.currentTurnRevision.current.set('s1', 3)
    return refs
  }

  it('六张表一个都不能少：逐张断言目标会话已被清掉', () => {
    const refs = fullRefs()

    clearTurnRefs(refs, 's1')

    // 这三张是「少清就会真出事」的重点：迟到的引导 / 旧确认卡复活 / revision 屏障失效。
    expect(refs.deliveredSteers.current.has('s1')).toBe(false)
    expect(refs.inFlightConfirmation.current.has('s1')).toBe(false)
    expect(refs.currentTurnRevision.current.has('s1')).toBe(false)
    // 另外三张同样必须清：旧信号、上一轮 turnId、上一轮 jobId。
    expect(refs.abort.current.has('s1')).toBe(false)
    expect(refs.currentTurnId.current.has('s1')).toBe(false)
    expect(refs.currentTurnJobId.current.has('s1')).toBe(false)
  })

  it('只清目标会话，别的会话原样保留', () => {
    const refs = fullRefs()
    refs.abort.current.set('s2', new AbortController())
    refs.deliveredSteers.current.set('s2', new Set(['steer-b']))
    refs.currentTurnId.current.set('s2', 'turn-b')
    refs.currentTurnJobId.current.set('s2', 'job-b')
    refs.currentTurnRevision.current.set('s2', 9)

    clearTurnRefs(refs, 's1')

    expect(refs.abort.current.has('s2')).toBe(true)
    expect(refs.deliveredSteers.current.get('s2')?.has('steer-b')).toBe(true)
    expect(refs.currentTurnId.current.get('s2')).toBe('turn-b')
    expect(refs.currentTurnJobId.current.get('s2')).toBe('job-b')
    expect(refs.currentTurnRevision.current.get('s2')).toBe(9)
  })

  it('重复清理是幂等的（停止与确认卡可能各收口一次）', () => {
    const refs = fullRefs()

    clearTurnRefs(refs, 's1')
    expect(() => clearTurnRefs(refs, 's1')).not.toThrow()
    expect(refs.abort.current.size).toBe(0)
    expect(refs.deliveredSteers.current.size).toBe(0)
    expect(refs.inFlightConfirmation.current.size).toBe(0)
    expect(refs.currentTurnId.current.size).toBe(0)
    expect(refs.currentTurnJobId.current.size).toBe(0)
    expect(refs.currentTurnRevision.current.size).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import type { AgentNodeType } from '../../../../domain/agent/plan'
import {
  buildAgentToolDefaults,
  createAgentToolDefaults,
  type AgentToolDefaultsPorts,
} from './agentToolDefaults'

describe('buildAgentToolDefaults', () => {
  it('逐个类型取默认值，结果按类型归档', async () => {
    const asked: AgentNodeType[] = []
    const ports: AgentToolDefaultsPorts = {
      defaultsFor: async (type) => {
        asked.push(type)
        return { kind: type, channelId: 'ch-a', model: 'model-a' }
      },
    }

    const out = await buildAgentToolDefaults(
      ['generation', 'prompt'],
      ports,
    )

    expect(asked).toEqual(['generation', 'prompt'])
    expect(out).toEqual({
      generation: { kind: 'generation', channelId: 'ch-a', model: 'model-a' },
      prompt: { kind: 'prompt', channelId: 'ch-a', model: 'model-a' },
    })
  })

  it('是串行的：上一个 resolve 之后才开始下一个', async () => {
    const order: string[] = []
    const ports: AgentToolDefaultsPorts = {
      defaultsFor: async (type) => {
        order.push(`start:${type}`)
        await Promise.resolve()
        order.push(`end:${type}`)
        return {}
      },
    }

    await buildAgentToolDefaults(['generation', 'batch'], ports)

    expect(order).toEqual([
      'start:generation',
      'end:generation',
      'start:batch',
      'end:batch',
    ])
  })

  it('空清单直接给空对象，不碰端口', async () => {
    let calls = 0
    const ports: AgentToolDefaultsPorts = {
      defaultsFor: async () => {
        calls += 1
        return {}
      },
    }

    await expect(buildAgentToolDefaults([], ports)).resolves.toEqual({})
    expect(calls).toBe(0)
  })

  it('同一类型出现两次时后一次覆盖前一次', async () => {
    let round = 0
    const ports: AgentToolDefaultsPorts = {
      defaultsFor: async () => {
        round += 1
        return { round }
      },
    }

    const out = await buildAgentToolDefaults(['generation', 'generation'], ports)

    expect(round).toBe(2)
    expect(out).toEqual({ generation: { round: 2 } })
  })

  it('某类型取值失败时原样抛出，后面的类型不再取', async () => {
    const asked: AgentNodeType[] = []
    const boom = new Error('渠道目录读不出来')
    const ports: AgentToolDefaultsPorts = {
      defaultsFor: async (type) => {
        asked.push(type)
        if (type === 'prompt') throw boom
        return {}
      },
    }

    await expect(
      buildAgentToolDefaults(['generation', 'prompt', 'batch'], ports),
    ).rejects.toBe(boom)
    expect(asked).toEqual(['generation', 'prompt'])
  })
})

describe('createAgentToolDefaults', () => {
  it('包装出的 defaultsForNewNode 与直接调用一致', async () => {
    const ports: AgentToolDefaultsPorts = {
      defaultsFor: async (type) => ({ from: type }),
    }

    const { defaultsForNewNode } = createAgentToolDefaults(ports)

    await expect(defaultsForNewNode(['group'])).resolves.toEqual({
      group: { from: 'group' },
    })
  })
})

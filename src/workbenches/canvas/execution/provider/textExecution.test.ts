import { describe, expect, it, vi } from 'vitest'
import { createMemoryPlatform } from '../../../../platform/memory'
import { createChannel } from '../../../../domain/project/channel'
import type { Channel } from '../../../../domain/project/channel'
import { completeCanvasText } from './textExecution'

function channelFixture(): Channel {
  return {
    ...createChannel({ name: 'Mock', protocol: 'mock', baseUrl: '' }),
    id: 'ch-valid',
    enabled: true,
    modelMap: { 'chat-model': 'upstream-chat' },
    models: [{
      id: 'chat-model',
      category: 'chat',
      inputTypes: ['text'],
    }],
    modelCache: [{
      id: 'chat-model',
      category: 'chat',
      inputTypes: ['text'],
    }],
    credentialGroups: [],
  } as Channel
}

function setup() {
  const platform = createMemoryPlatform()
  const generation = {
    completeText: vi.fn(async () => ({ text: 'answer' })),
  }
  const signal = new AbortController().signal
  const ports = {
    channels: () => [channelFixture()],
    generation,
    storage: platform.storage,
    projectId: () => 'p1',
    workbench: 'canvas' as const,
    notify: vi.fn(),
    track: vi.fn((task: () => Promise<string>) => task()),
    linkedSignal: () => signal,
  }
  return { generation, ports, signal }
}

describe('canvas text execution', () => {
  it('固定逻辑名选路、上游映射、请求正文与链接 signal', async () => {
    const { generation, ports, signal } = setup()
    const result = await completeCanvasText({
      channelId: 'stale-channel',
      model: 'chat-model',
      subjectId: 'prompt-1',
      purpose: 'skill',
      system: 'system',
      text: 'draft',
      inputs: [],
      signal,
    }, ports)

    expect(result).toBe('answer')
    expect(generation.completeText).toHaveBeenCalledTimes(1)
    const [request, callSignal] = generation.completeText.mock.calls[0] as unknown as [
      Record<string, unknown>,
      AbortSignal,
    ]
    expect(request.channel).toMatchObject({ id: 'ch-valid' })
    expect(request.model).toBe('chat-model')
    expect(request.request).toMatchObject({
      kind: 'text',
      prompt: 'system\n\ndraft',
      inputs: [],
      params: {},
    })
    expect(request.hints).toHaveProperty('operationId')
    expect(callSignal.aborted).toBe(signal.aborted)
  })

  it('缺可用模型时零付费请求', async () => {
    const { generation, ports, signal } = setup()
    ports.channels = () => []
    await expect(completeCanvasText({
      channelId: 'ch-valid',
      model: 'chat-model',
      subjectId: 'prompt-1',
      purpose: 'skill',
      system: '',
      text: 'draft',
      signal,
    }, ports)).rejects.toMatchObject({ name: 'ChannelError' })
    expect(generation.completeText).not.toHaveBeenCalled()
  })

  it('日志写入失败只提示，不覆盖模型结果', async () => {
    const { generation, ports, signal } = setup()
    generation.completeText.mockResolvedValueOnce({ text: 'still-ok' } as never)
    ports.storage = {
      ...ports.storage,
      put: vi.fn(async () => {
        throw new Error('runRecords unavailable')
      }),
    } as never

    const result = await completeCanvasText({
      channelId: 'ch-valid',
      model: 'chat-model',
      subjectId: 'prompt-1',
      purpose: 'text',
      system: '',
      text: 'draft',
      signal,
    }, ports)

    expect(result).toBe('still-ok')
    expect(ports.notify).toHaveBeenCalledWith(
      expect.stringContaining('结果已返回，但运行日志写入失败'),
      'error',
    )
  })
})

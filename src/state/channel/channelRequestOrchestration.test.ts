import { describe, expect, it, vi } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { directTextTrace } from '../shared/directRun'
import { createContextRepository } from '../shared/contextRepository'
import { createChannelRequestOrchestration } from './channelRequestOrchestration'

function trace(channelId: string, model: string) {
  return directTextTrace({
    projectId: 'proj_orchestration',
    workbench: 'canvas',
    subjectId: 'chat_session',
    scopeId: 'session:chat_session',
    operationId: 'op-orchestration',
    purpose: 'agent',
    channelId,
    model,
    prompt: 'test',
  })
}

function fixture() {
  const platform = createMemoryPlatform()
  let channels = [{
    id: 'ch-1',
    name: 'Mock',
    protocol: 'mock',
    baseUrl: '',
    modelMap: {},
  }] as never[]
  const contextRepo = createContextRepository(platform.storage)
  const generation = {
    completeText: vi.fn(async () => ({ text: 'ok' })),
    streamText: vi.fn(async () => ({ text: 'streamed' })),
    generateSpeech: vi.fn(async () => ({ hash: 'audio-1', mime: 'audio/wav', bytes: new Uint8Array() })),
    generateVideo: vi.fn(async () => [{ hash: 'video-1', mime: 'video/mp4', bytes: new Uint8Array() }]),
  }
  const requests = createChannelRequestOrchestration({
    platform,
    contextRepo,
    generation: generation as never,
    channels: () => channels as never,
  })
  return { platform, contextRepo, generation, requests, clearChannels: () => { channels = [] } }
}

describe('channelRequestOrchestration', () => {
  it('context conflict is rejected before generation and before RunRecord', async () => {
    const { platform, requests, generation } = fixture()
    const memoryRow = (id: string, text: string) => ({
      id, kind: 'fact', text, scope: 'project',
      projectId: 'proj_orchestration', key: 'brand.primaryColor',
      source: 'user', confidence: 1, enabled: true,
      currentRevision: 1, createdAt: 1, updatedAt: 1,
    })
    await platform.storage.put('contextMemories', memoryRow('m1', 'green') as never)
    await platform.storage.put('contextMemories', memoryRow('m2', 'black') as never)

    await expect(requests.completeWithTools({
      channelId: 'ch-1', model: 'm', tools: [],
      messages: [{ role: 'user', content: 'test' }],
      signal: new AbortController().signal,
      trace: trace('ch-1', 'm'),
    })).rejects.toMatchObject({ appError: { kind: 'parse' } })
    expect(generation.completeText).not.toHaveBeenCalled()
    expect(await platform.storage.query('runRecords', {})).toHaveLength(0)
  })

  it('appends context assets once in bundle order and preserves caller inputs', async () => {
    const { platform, requests, generation, contextRepo } = fixture()
    for (const hash of ['kit-a', 'kit-b']) {
      await platform.storage.put('assets', { id: hash, mime: 'image/png', bytes: new Uint8Array([1]) })
    }
    const kit = await contextRepo.createKit({ kind: 'brand', name: 'Brand', assetHashes: ['kit-a', 'kit-b'] })
    await contextRepo.bindProject({ projectId: 'proj_orchestration', kitId: kit.kit.id, kitVersion: 1 })

    await requests.completeWithTools({
      channelId: 'ch-1', model: 'm', tools: [],
      inputs: [{ kind: 'asset', nodeId: 'first', assetHash: 'kit-a', mime: 'image/png' }],
      messages: [{ role: 'user', content: 'test' }],
      signal: new AbortController().signal,
      trace: trace('ch-1', 'm'),
    })
    const callArgs = (generation.completeText.mock.calls[0] as unknown as [
      { request: { inputs: { kind: string; assetHash: string }[] } },
    ])[0]
    expect(callArgs.request.inputs).toEqual([
      { kind: 'asset', nodeId: 'first', assetHash: 'kit-a', mime: 'image/png' },
      expect.objectContaining({ kind: 'asset', assetHash: 'kit-b' }),
    ])
  })

  it('writes one successful RunRecord and reports the real route', async () => {
    const { platform, requests } = fixture()
    const succeeded: unknown[] = []
    await requests.completeWithTools({
      channelId: 'ch-1', model: 'logical', tools: [],
      messages: [{ role: 'user', content: 'test' }],
      signal: new AbortController().signal,
      routeCandidates: [{ channelId: 'ch-1', model: 'upstream' }],
      onRouteSucceeded: (route) => succeeded.push(route),
      trace: trace('ch-1', 'logical'),
    })
    expect(succeeded).toEqual([{ channelId: 'ch-1', model: 'upstream' }])
    const records = await platform.storage.query('runRecords', {})
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ status: 'succeeded', sentModel: 'upstream' })
  })

  it('writes one failed RunRecord and preserves thrown error semantics', async () => {
    const { platform, requests, generation } = fixture()
    const failure = new Error('model failed')
    generation.completeText.mockRejectedValueOnce(failure)

    await expect(requests.completeWithTools({
      channelId: 'ch-1', model: 'm', tools: [],
      messages: [{ role: 'user', content: 'test' }],
      signal: new AbortController().signal,
      trace: trace('ch-1', 'm'),
    })).rejects.toBe(failure)
    const records = await platform.storage.query('runRecords', {})
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ status: 'failed' })
  })

  it('keeps speech/video facade behavior with optional trace', async () => {
    const { platform, requests, generation } = fixture()
    const signal = new AbortController().signal
    const speech = await requests.generateSpeech({
      channelId: 'ch-1', model: 'tts', text: 'hello', voice: 'nova', signal,
    })
    expect(speech.hash).toBe('audio-1')
    expect(await platform.storage.query('runRecords', {})).toHaveLength(0)
    expect(generation.generateSpeech).toHaveBeenCalledTimes(1)

    const videoTrace = { ...trace('ch-1', 'video'), params: { kind: 'video' }, fingerprint: 'fp-video' }
    const videos = await requests.generateVideo({
      kind: 'video', channelId: 'ch-1', model: 'video',
      prompt: 'test', inputs: [], params: {}, signal, trace: videoTrace,
    })
    expect(videos).toHaveLength(1)
    const records = await platform.storage.query('runRecords', {})
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ status: 'succeeded', outputHashes: ['video-1'] })
  })
})

import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../../platform/memory'
import { createChannelStore } from '../channelStore'
import { directTextTrace } from '../../shared/directRun'
import { initialChannelStoreState } from './contracts'

const ACTION_NAMES = [
  'load', 'protocolCatalog', 'createCustomProtocol', 'removeCustomProtocol',
  'removeBuiltinProtocol', 'restoreBuiltinProtocols', 'create', 'update', 'remove',
  'globalModelsOf', 'globalModelOf', 'addGlobalModel', 'removeGlobalModel',
  'setModelUncommon', 'testModelMapping', 'reorder', 'saveToken', 'loadToken',
  'removeToken', 'addCredentialGroup', 'renameCredentialGroup',
  'setCredentialGroupPriority', 'removeCredentialGroup', 'saveCredentialGroupToken',
  'loadCredentialGroupToken', 'removeCredentialGroupToken', 'setEnabled', 'setModels',
  'setModelCategory', 'setModelMapping', 'setRouteTuning', 'setRouteStrategy',
  'setRoutingPolicy', 'planGenerationRoute', 'hasToken', 'verify', 'detectProtocol',
  'refreshModels', 'enabledChannels', 'rememberRecipe', 'setRecipeMemory',
  'setDefaultRecipe', 'defaultForNewNode', 'completeWithTools', 'generateSpeech',
  'generateVideo',
] as const

describe('channelStore/publicApi', () => {
  it('keeps the zustand store shape, every public action and their arity stable', async () => {
    const platform = createMemoryPlatform()
    const store = createChannelStore(platform, { seedBuiltins: false })
    expect(Object.keys(initialChannelStoreState()).sort()).toEqual([
      'channels', 'customModels', 'customProtocols', 'detect', 'hiddenBuiltinProtocolIds',
      'loaded', 'models', 'recipeMemory', 'routeStrategy', 'routingPolicy',
      'uncommonModelIds', 'verify',
    ])
    expect(typeof store.getState).toBe('function')
    expect(typeof store.setState).toBe('function')
    expect(typeof store.subscribe).toBe('function')
    for (const action of ACTION_NAMES) expect(typeof store[action]).toBe('function')
    expect(store.completeWithTools.length).toBe(1)
    expect(store.generateSpeech.length).toBe(1)
    expect(store.generateVideo.length).toBe(1)
    expect(store.create.length).toBe(1)
    expect(store.update.length).toBe(2)
    expect(store.setModels.length).toBe(3)
  })

  it('keeps RunRecord terminal state and route success callback order unchanged', async () => {
    const platform = createMemoryPlatform()
    const store = createChannelStore(platform, { seedBuiltins: false })
    const created = await store.create({ name: 'Mock', protocol: 'mock', baseUrl: '' })
    const events: string[] = []
    const result = await store.completeWithTools({
      channelId: created.id,
      model: 'mock-chat-1',
      tools: [],
      messages: [{ role: 'user', content: 'check order' }],
      signal: new AbortController().signal,
      routeCandidates: [{ channelId: created.id, model: 'mock-chat-1' }],
      onRouteSucceeded: (route) => events.push(`success:${route.channelId}:${route.model}`),
      trace: directTextTrace({
        projectId: 'proj_order',
        workbench: 'canvas',
        subjectId: 'chat_session',
        scopeId: 'session:chat_session',
        operationId: 'op-order',
        purpose: 'agent',
        channelId: created.id,
        model: 'mock-chat-1',
        prompt: 'check order',
      }),
    })
    expect(result.text).toBeTruthy()
    const records = await platform.storage.query('runRecords', { projectId: 'proj_order' })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ status: 'succeeded' })
    expect(events).toEqual([`success:${created.id}:mock-chat-1`])
  })

  it('keeps remove synchronously ahead of credential cleanup and guards a second direct call', async () => {
    const base = createMemoryPlatform()
    const events: string[] = []
    const platform = {
      ...base,
      credentials: {
        ...base.credentials,
        async remove(ref: string) {
          events.push('credential')
          await base.credentials.remove(ref)
        },
      },
    }
    const store = createChannelStore(platform, { seedBuiltins: false })
    const created = await store.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    await store.saveToken(created.id, 'old-key')
    const removal = store.remove(created.id)
    expect(store.getState().channels.some((channel) => channel.id === created.id)).toBe(false)
    expect(events).toEqual([])
    await removal
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((event) => event === 'credential')).toBe(true)
    await expect(store.completeWithTools({
      channelId: created.id,
      model: 'mock-chat-1',
      tools: [],
      messages: [{ role: 'user', content: 'must not run' }],
      signal: new AbortController().signal,
      trace: directTextTrace({
        projectId: 'proj_removed',
        workbench: 'canvas',
        subjectId: 'chat_session',
        scopeId: 'session:chat_session',
        operationId: 'op-removed',
        purpose: 'agent',
        channelId: created.id,
        model: 'mock-chat-1',
        prompt: 'must not run',
      }),
    })).rejects.toMatchObject({ appError: { kind: 'channel', detail: 'missingChannel' } })
  })
})

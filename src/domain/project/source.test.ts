import { describe, expect, it } from 'vitest'
import { protocolById } from './protocol'
import { protocolSourceDescriptor } from './source'

function definition(id: string) {
  const result = protocolById(id)
  if (!result) throw new Error(`missing protocol fixture: ${id}`)
  return result
}

describe('protocolSourceDescriptor', () => {
  it('classifies API protocols from their adapter family, not their display name', () => {
    expect(protocolSourceDescriptor(definition('openai-compatible'))).toMatchObject({
      protocolId: 'openai-compatible',
      siteId: 'openai-compatible',
      sourceKind: 'api',
      authKind: 'api-key',
    })
    expect(protocolSourceDescriptor(definition('runninghub-llm'))).toMatchObject({
      sourceKind: 'api',
      authKind: 'api-key',
    })
  })

  it('keeps offline mock protocols credential-free', () => {
    expect(protocolSourceDescriptor(definition('mock'))).toEqual({
      protocolId: 'mock',
      siteId: 'mock',
      sourceKind: 'local-model',
      authKind: 'none',
    })
  })

  it('classifies CLI gateways as CLI sessions', () => {
    expect(
      protocolSourceDescriptor({
        id: 'jimeng-cli-gateway',
        family: 'cli-gateway',
        credentials: [],
      }),
    ).toEqual({
      protocolId: 'jimeng-cli-gateway',
      siteId: 'jimeng-cli-gateway',
      sourceKind: 'cli',
      authKind: 'cli-session',
    })
  })

  it('does not invent credentials for a no-auth declarative protocol', () => {
    expect(
      protocolSourceDescriptor({
        id: 'local-http',
        family: 'declarative-http',
        credentials: [],
      }),
    ).toMatchObject({ sourceKind: 'api', authKind: 'none' })
  })
})

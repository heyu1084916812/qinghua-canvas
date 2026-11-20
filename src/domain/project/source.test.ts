import { describe, expect, it } from 'vitest'
import { protocolById } from './protocol'
import { protocolSourceDescriptor, sourceOperationsFor, sourceSiteCatalogOf, sourceSiteDescriptorOf } from './source'

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


describe('sourceOperationsFor', () => {
  it('does not confuse API-key configuration with login/logout', () => {
    const operations = sourceOperationsFor({ sourceKind: 'api', authKind: 'api-key' })
    expect(operations).toMatchObject({
      verify: true,
      listModels: true,
      login: false,
      logout: false,
      status: true,
      quickTest: true,
      cancel: true,
    })
  })

  it('gives CLI sources the full session lifecycle', () => {
    expect(sourceOperationsFor({ sourceKind: 'cli', authKind: 'cli-session' })).toEqual({
      verify: true,
      listModels: true,
      login: true,
      logout: true,
      status: true,
      quickTest: true,
      cancel: true,
    })
  })
})


describe('sourceSiteDescriptorOf', () => {
  it('把同一个 CLI 站点的协议稳定归并到站点层', () => {
    expect(sourceSiteDescriptorOf(definition('jimeng-cli'))).toMatchObject({
      siteId: 'jimeng',
      label: '即梦',
      iconKey: 'jimeng',
      protocolIds: ['jimeng-cli'],
      sourceKind: 'cli',
      authKind: 'cli-session',
      operations: { login: true, logout: true },
    })
  })

  it('不把 API 协议的展示名当作站点身份，也不伪造登录能力', () => {
    expect(sourceSiteDescriptorOf(definition('openai-compatible'))).toMatchObject({
      siteId: 'openai-compatible',
      label: 'openai-compatible',
      iconKey: 'openai-compatible',
      protocolIds: ['openai-compatible'],
      sourceKind: 'api',
      authKind: 'api-key',
      operations: { login: false, logout: false },
    })
  })
})


describe('sourceSiteCatalogOf', () => {
  it('把同站点的多个协议合并成一个站点条目并保留协议顺序', () => {
    const defs = ['jimeng-cli', 'gpt-cli', 'gemini-cli'].map((id) => definition(id))
    const sites = sourceSiteCatalogOf([...defs, { id: 'jimeng-cli-gateway', family: 'cli-gateway', credentials: [] }])
    expect(sites.map((site) => [site.siteId, site.protocolIds])).toEqual([
      ['jimeng', ['jimeng-cli', 'jimeng-cli-gateway']],
      ['codex', ['gpt-cli']],
      ['gemini', ['gemini-cli']],
    ])
  })
})

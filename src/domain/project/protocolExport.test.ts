import { describe, expect, it } from 'vitest'
import type { ProtocolDefinition } from './protocol'
import {
  builtinProtocolReferenceForExport,
  protocolPackageForExport,
  serializeBuiltinProtocolReference,
  serializeProtocolPackage,
} from './protocolExport'
import { parseDeclarativeProtocol } from './protocolRecipe'

describe('protocolPackageForExport', () => {
  it('round-trips imported declarative protocols without credentials', () => {
    const definition: ProtocolDefinition = {
      id: 'imported-relay',
      name: '导入中转',
      short: 'IMP',
      family: 'declarative-http',
      kind: 'custom',
      status: 'ready',
      capabilities: ['chat', 'image'],
      versionPath: '/v1',
      recipe: {
        version: 1,
        auth: { type: 'bearer' },
        models: {
          request: { method: 'GET', path: '/models' },
          items: '$.data[*]',
          id: '$.id',
          category: 'chat',
        },
        chat: {
          request: { method: 'POST', path: '/chat' },
          response: { text: '$.text' },
        },
        image: {
          request: { method: 'POST', path: '/images' },
          result: ['$.url'],
        },
      },
    }
    const pkg = protocolPackageForExport(definition)
    expect(pkg).not.toBeNull()
    const text = serializeProtocolPackage(pkg!)
    expect(text).not.toContain('apiKey')
    expect(parseDeclarativeProtocol(text)).toMatchObject({
      ok: true,
      value: {
        id: 'imported-relay',
        capabilities: ['chat', 'image'],
      },
    })
  })

  it('converts legacy manually created OpenAI-compatible protocols', () => {
    const pkg = protocolPackageForExport({
      id: 'legacy-relay',
      name: '旧中转',
      short: 'OLD',
      family: 'openai-compatible',
      kind: 'custom',
      status: 'ready',
      capabilities: ['chat', 'image'],
      versionPath: '/api/v3',
    })
    expect(pkg).toMatchObject({
      schema: 'qinghua.protocol/v1',
      id: 'legacy-relay',
      versionPath: '/api/v3',
      capabilities: ['chat', 'image'],
      recipe: { auth: { type: 'bearer' } },
    })
    expect(parseDeclarativeProtocol(serializeProtocolPackage(pkg!)).ok).toBe(true)
  })

  it('does not pretend built-in provider-specific protocols are portable', () => {
    expect(
      protocolPackageForExport({
        id: 'soonstudio',
        name: 'SoonStudio',
        short: 'SOON',
        family: 'openai-compatible',
        kind: 'station',
        status: 'ready',
        capabilities: ['chat', 'image'],
      }),
    ).toBeNull()
  })

  it('exports built-in protocols as read-only reference documents', () => {
    const reference = builtinProtocolReferenceForExport({
      id: 'soonstudio',
      name: 'SoonStudio',
      short: 'SOON',
      family: 'openai-compatible',
      kind: 'station',
      status: 'ready',
      capabilities: ['chat', 'image', 'video'],
      defaultBaseUrl: 'https://soonstudio.ai',
      versionPath: '/v1',
      docUrl: 'https://soonstudio.ai/docs',
      credentials: [{ id: 'main', label: 'API Key', required: true }],
    })
    expect(reference).toMatchObject({
      schema: 'qinghua.protocol-reference/v1',
      id: 'soonstudio',
      kind: 'station',
      family: 'openai-compatible',
      credentials: [{ id: 'main', label: 'API Key', required: true }],
    })
    const text = serializeBuiltinProtocolReference(reference!)
    expect(text).not.toContain('apiKey')
    expect(parseDeclarativeProtocol(text).ok).toBe(false)
  })
})

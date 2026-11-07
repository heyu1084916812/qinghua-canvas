// @ts-expect-error -- 项目刻意不引入 @types/node；Node fs 静态取证只属于测试。
import { readFileSync } from 'node:fs'
// @ts-expect-error -- 同上：path 仅用于把源码路径锚定到仓库根。
import { dirname, resolve } from 'node:path'
// @ts-expect-error -- 同上：url 用于把测试文件 URL 转成源码根路径。
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { THREE_D_CAPABILITY_SPEC, threeDGenerationSupported } from './threeDCapability'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const source = (file: string) => readFileSync(resolve(root, file), 'utf8')
const quoted = (expression: string) =>
  [...expression.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1])

const categoryUnion = (text: string) => {
  const match = text.match(/interface\s+ModelCapability\s*\{[\s\S]*?category:\s*([^\n;]+)/)
  if (!match) throw new Error('ModelCapability.category not found')
  return quoted(match[1])
}

const protocolUnion = (text: string) => {
  const match = text.match(/type\s+ProtocolCapability\s*=\s*([^\n;]+)/)
  if (!match) throw new Error('ProtocolCapability not found')
  return quoted(match[1])
}

const assertBoundary = (capability: string, protocol: string, settings: string) => {
  expect(categoryUnion(capability)).not.toContain('3d')
  expect(protocolUnion(protocol)).not.toContain('3d')
  expect(categoryUnion(capability)).toEqual(THREE_D_CAPABILITY_SPEC.runtimeCategories)
  expect(protocolUnion(protocol)).toEqual(THREE_D_CAPABILITY_SPEC.protocolCapabilities)
  expect(settings).toContain('3D')
  expect(settings).toContain('后两档（音频 / 3D）是**预留位**')
  expect(settings).toContain("ModelCapability['category']")
  expect(settings).toContain('这一类还没有模型')
}

describe('3D capability boundary', () => {
  it('defers 3D generation and keeps the single judgement false', () => {
    expect(THREE_D_CAPABILITY_SPEC.status).toBe('deferred')
    expect(THREE_D_CAPABILITY_SPEC.generation).toBe(false)
    expect(THREE_D_CAPABILITY_SPEC.uiFilter).toEqual({
      visibility: 'visible',
      selectable: false,
      state: 'empty',
    })
    expect(THREE_D_CAPABILITY_SPEC.prerequisites).toEqual([
      'domain-types-and-routing',
      'registered-channel-adapter',
      'verified-generation-endpoint',
      'node-and-result-shapes',
      'real-endpoint-acceptance',
    ])
    expect(Object.isFrozen(THREE_D_CAPABILITY_SPEC)).toBe(true)
    expect(Object.isFrozen(THREE_D_CAPABILITY_SPEC.uiFilter)).toBe(true)
    expect(Object.isFrozen(THREE_D_CAPABILITY_SPEC.runtimeCategories)).toBe(true)
    expect(Object.isFrozen(THREE_D_CAPABILITY_SPEC.protocolCapabilities)).toBe(true)
    expect(Object.isFrozen(THREE_D_CAPABILITY_SPEC.prerequisites)).toBe(true)
    expect(threeDGenerationSupported()).toBe(false)
    expect(threeDGenerationSupported).toHaveLength(0)

    const specSource = source('src/domain/shared/threeDCapability.ts')
    expect(specSource).toMatch(/function threeDGenerationSupported\(\): false \{\s*return false\s*\}/)
    expect(specSource).not.toContain('return THREE_D_CAPABILITY_SPEC.generation')
  })

  it('reads the current runtime unions and SettingsPage reserved comment', () => {
    assertBoundary(
      source('src/domain/shared/capability.ts'),
      source('src/domain/project/protocol.ts'),
      source('src/pages/SettingsPage/SettingsPage.tsx'),
    )
  })

  it('fails if either union gains 3D without also changing this spec', () => {
    const capability = source('src/domain/shared/capability.ts')
    const protocol = source('src/domain/project/protocol.ts')
    const settings = source('src/pages/SettingsPage/SettingsPage.tsx')
    const categoryWith3D = capability.replace(
      "'audio' | 'unknown'",
      "'audio' | 'unknown' | '3d'",
    )
    const protocolWith3D = protocol.replace(
      "'video' | 'audio'",
      "'video' | 'audio' | '3d'",
    )

    expect(categoryUnion(categoryWith3D)).toContain('3d')
    expect(protocolUnion(protocolWith3D)).toContain('3d')
    expect(() => assertBoundary(categoryWith3D, protocol, settings)).toThrow()
    expect(() => assertBoundary(capability, protocolWith3D, settings)).toThrow()
  })
})

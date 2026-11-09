// @ts-expect-error -- 项目刻意不引入 @types/node；扩展静态取证只属于测试。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const extensionRoot = new URL(
  '../../../browser-extension/qinghua-clipper/',
  import.meta.url,
)

describe('qinghua clipper extension contract', () => {
  it('requests only the active tab, local storage and the loopback receiver', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('manifest.json', extensionRoot), 'utf8'),
    ) as {
      manifest_version: number
      permissions: string[]
      host_permissions: string[]
    }

    expect(manifest.manifest_version).toBe(3)
    expect(manifest.permissions).toEqual(['activeTab', 'storage'])
    expect(manifest.host_permissions).toEqual([
      'http://127.0.0.1:53684/*',
    ])
  })

  it('sends the URL and token without reading browser cookies', () => {
    const source = readFileSync(new URL('popup.js', extensionRoot), 'utf8')

    expect(source).toContain('X-Qinghua-Clipper-Token')
    expect(source).toContain('http://127.0.0.1:53684/clip')
    expect(source).not.toMatch(/document\.cookie|chrome\.cookies/)
  })
})

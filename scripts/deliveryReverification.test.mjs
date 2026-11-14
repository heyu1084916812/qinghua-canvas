import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative) => readFileSync(
  fileURLToPath(new URL(`../${relative}`, import.meta.url)),
  'utf8',
)

/** 目录下全部 .md 拼起来（分卷文档用：判据针对「整份文档」而不是某一个文件） */
const readAll = (relativeDir) => {
  const dir = fileURLToPath(new URL(`../${relativeDir}`, import.meta.url))
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => readFileSync(`${dir}/${name}`, 'utf8'))
    .join('\n')
}

describe('production first-paint probe evidence contract', () => {
  it('records the current HEAD, test seed, measured phases and geometry in result.json', () => {
    const source = read('scripts/verify-storage-log-first-paint-production.mjs')

    expect(source).toContain("['rev-parse', 'HEAD']")
    expect(source).toContain("['status', '--porcelain=v1']")
    expect(source).toContain('distSha256')
    expect(source).toContain('sourceTree:')
    expect(source).toContain('trackedClean')
    expect(source).toContain('generatedAt: new Date().toISOString()')
    expect(source).toContain("mode: 'production'")
    expect(source).toContain('seed: { projects: projects.length, assets: assets.length, runRecords: runRecords.length }')
    expect(source).toContain("'storage-usage-and-projects'")
    expect(source).toContain("'global-log-first-row'")
    expect(source).toContain("'canvas-log-first-row'")
    expect(source).toContain('geometry,')
    expect(source).toContain('errors,')
  })

  it('keeps the production probe out of the user services and requires an existing build', () => {
    const source = read('scripts/verify-storage-log-first-paint-production.mjs')

    expect(source).toContain("for (const reserved of [1420, 18765, 18766, 18791])")
    expect(source).toContain("if (!existsSync(path.join(distDir, 'index.html')))")
    expect(source).toContain("if (!existsSync(storeExe))")
    expect(source).toContain("killTree(store)")
    expect(source).toContain("killTree(preview)")
  })

  it('keeps README and product storage descriptions on the current shared-store truth', () => {
    const readme = read('README.md')
    // 2026-11-14 起产品设计文档按章分卷（docs/product/），断言改成读全部分卷，
    // 判据不变：整份产品文档里仍然只能出现 shared-store 这套口径。
    const product = readAll('docs/product')

    expect(readme).toContain('本地 0.1.17 安装包已构建并通过 release 壳自检')
    expect(readme).not.toContain('本轮未构建安装包')
    expect(product).toContain('业务主库由本机 `shared-store` 提供')
    expect(product).toContain('凭据存于本机 shared-store')
    expect(product).not.toContain('凭据由 WebCrypto `AES-GCM` 加密后存于 IndexedDB')
  })
})

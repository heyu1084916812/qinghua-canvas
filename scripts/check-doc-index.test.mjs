import { describe, expect, it } from 'vitest'
import { evaluateIndex, parseRegistrations } from './check-doc-index.mjs'

const INDEX = [
  '# 文档总索引',
  '',
  '| 文档 | 性质 |',
  '| --- | --- |',
  '| `README.md` | 入口 |',
  '| `AGENTS.md` | 约定 |',
  '',
  '| 目录 | 装什么 |',
  '| --- | --- |',
  '| `docs/product/` | 产品文档分卷 |',
  '',
  '规则：新代码放 `ledger/按批记录-<年月>.md`，`docs/` 下不许再堆大文件。',
].join('\n')

const actual = ['README.md', 'AGENTS.md', 'docs/product/01-定位.md', 'docs/product/06-画布-1.md']

describe('parseRegistrations', () => {
  it('separates root files from directory registrations', () => {
    const { files, dirs } = parseRegistrations(INDEX)
    expect([...files].sort()).toEqual(['AGENTS.md', 'README.md'])
    expect([...dirs]).toEqual(['docs/product'])
  })

  it('ignores template placeholders and bare extensions', () => {
    const { files, dirs } = parseRegistrations(
      '`ledger/按批记录-<年月>.md` `release-notes/v<版本>.md` `.md` `docs/arch/`',
    )
    expect([...files]).toEqual([])
    expect([...dirs]).toEqual(['docs/arch'])
  })
})

describe('evaluateIndex', () => {
  it('passes when root files and a registered directory cover everything', () => {
    const result = evaluateIndex({ actual, indexText: INDEX })
    expect(result.missing).toEqual([])
    expect(result.rootCount).toBe(2)
    expect(result.subCount).toBe(2)
  })

  it('fails an unregistered root document', () => {
    const result = evaluateIndex({ actual: [...actual, '未登记.md'], indexText: INDEX })
    expect(result.missing).toEqual(['未登记.md'])
  })

  it('fails a subdirectory document when its directory is not registered', () => {
    const indexText = INDEX.replace('| `docs/product/` | 产品文档分卷 |', '')
    const result = evaluateIndex({ actual, indexText })
    expect(result.missing.sort()).toEqual(['docs/product/01-定位.md', 'docs/product/06-画布-1.md'])
  })

  it('fails when the index registers a file that no longer exists', () => {
    const indexText = `${INDEX}\n| \`docs/product/99-已删除.md\` | 旧 |`
    const result = evaluateIndex({ actual, indexText })
    expect(result.stale).toContain('docs/product/99-已删除.md')
  })
})

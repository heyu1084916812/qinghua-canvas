import { describe, expect, it } from 'vitest'
import { buildIndex, idsInArchive } from './ledger-index.mjs'

const ARCHIVE_A = [
  '# 轻画 · 按批记录 · 2026-11',
  '',
  '## 缺口汇总追加（2026-11-14）',
  '',
  '| # | 需求 | 状态 | 证据 |',
  '| --- | --- | --- | --- |',
  '| **1090** | 遇墙超时 | ✅ 已修 | x |',
  '| **1099** | 文档治理 | 🧩 进行中 | x |',
  '| G13 | 冒烟组 | ✅ | 正文里 #1090 的引用不算条目 |',
].join('\n')

const ARCHIVE_B = [
  '# 轻画 · 按批记录 · 2026-10',
  '',
  '## 第 66 批',
  '',
  '| # | 需求 | 状态 |',
  '| --- | --- | --- |',
  '| **1099** | 早期同名记录 | 📝 |',
  '| **378a** | 数据安全 | ✅ |',
].join('\n')

const entries = [
  { file: '按批记录-2026-11.md', text: ARCHIVE_A },
  { file: '按批记录-2026-10.md', text: ARCHIVE_B },
]

describe('idsInArchive', () => {
  it('reads table ids and keeps分档 ids and letter-prefixed ids', () => {
    const ids = idsInArchive(ARCHIVE_B)
    expect([...ids.keys()].sort()).toEqual(['1099', '378a'])
  })

  it('does not treat prose references as entries', () => {
    expect(idsInArchive(ARCHIVE_A).has('1090')).toBe(true)
    // 只出现了一次，在表格行里；正文那处 `#1090` 不计入
    expect(idsInArchive(ARCHIVE_A).get('1090')).toBe(1)
  })
})

describe('buildIndex', () => {
  const { text, fileCount, idCount, multiCount } = buildIndex(entries)

  it('lists every archive file with its section and line counts', () => {
    expect(fileCount).toBe(2)
    expect(text).toContain('| `ledger/按批记录-2026-11.md` | 轻画 · 按批记录 · 2026-11 | 1 |')
    expect(text).toContain('| `ledger/按批记录-2026-10.md` |')
  })

  it('lists the ids of each file so the gate can match both sides', () => {
    expect(idCount).toBe(4) // 1090 / 1099 / 378a / G13
    expect(text).toContain('#1090')
    expect(text).toContain('#378a')
    expect(text).toContain('#G13')
  })

  it('reports ids that appear in more than one file', () => {
    expect(multiCount).toBe(1)
    expect(text).toContain('| #1099 | `按批记录-2026-10.md` · `按批记录-2026-11.md` | 2 |')
  })

  it('says the file is generated, so nobody hand-edits it', () => {
    expect(text).toContain('node scripts/ledger-index.mjs')
    expect(text).toContain('不要手改')
  })
})

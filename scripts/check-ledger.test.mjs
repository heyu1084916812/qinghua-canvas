import { describe, expect, it } from 'vitest'
import { evaluate, idTokensOf, parseArchiveIds, parseOpenItems, parseReadme } from './check-ledger.mjs'

const ROOT_TEXT = [
  '# 轻画 · 功能对账清单（当前）',
  '',
  '| # | 需求 | 状态 | 卡在哪 |',
  '| --- | --- | --- | --- |',
  '| **1021** | 性能门禁 | ⏳ 超标 | 先定位抖动源 |',
  '| **1076** / **1076-1** | 站点适配器 | 🔍 待真机验收 | 桌面壳就绪时验 |',
  '| **198–200** | 素材存储增量 | 🧩 部分 | 只剩缺失策略 |',
  '',
  '| 位置 | 装什么 |',
  '| --- | --- |',
  '| `ledger/按批记录-2026-11.md` | 11 月的逐批记录 |',
].join('\n')

const ARCHIVE_TEXT = [
  '# 轻画 · 按批记录 · 2026-11',
  '',
  '| # | 需求 | 状态 | 做法 | 证据 |',
  '| --- | --- | --- | --- | --- |',
  '| **1021** | 性能门禁 | ⏳ 超标 | 见报告 | x |',
  '| **1076** | 站点适配器 | ✅ 已完成 | 见报告 | x |',
  '| **1076-1** | 花瓣 / 站酷 | ✅ 已完成 | 见报告 | x |',
  '| **198** | 增量 1 | ✅ 已完成 | 见报告 | x |',
  '| **199** | 增量 2 | ✅ 已完成 | 见报告 | x |',
  '| **200** | 增量 3 | ✅ 已完成 | 见报告 | x |',
  '| G13 | 冒烟组 | ✅ | 见 #1076 正文引用不算条目 | x |',
].join('\n')

const README_TEXT = [
  '# 对账归档索引',
  '',
  '| 文件 | 装什么 | 段数 | 行数 |',
  '| --- | --- | --- | --- |',
  '| `ledger/按批记录-2026-11.md` | 11 月 | 18 | 3164 |',
  '',
  '**ledger/按批记录-2026-11.md**（7 个编号）',
  '',
  '#1021 · #1076 · #1076-1 · #198 · #199 · #200 · #G13',
].join('\n')

const archivesOf = (entries) => new Map(entries)

describe('idTokensOf', () => {
  it('accepts a plain id and strips bold markers', () => {
    expect(idTokensOf('**1021**')).toEqual(['1021'])
  })

  it('accepts several ids in one cell', () => {
    expect(idTokensOf('**1076** / **1076-1**')).toEqual(['1076', '1076-1'])
  })

  it('expands a range into individual ids', () => {
    expect(idTokensOf('**198–200**')).toEqual(['198', '199', '200'])
  })

  it('rejects a cell that is a file path, not an id', () => {
    expect(idTokensOf('`ledger/按批记录-2026-11.md` · `-2026-12.md`')).toEqual([])
  })

  it('rejects a header cell', () => {
    expect(idTokensOf('#')).toEqual([])
  })
})

describe('parseOpenItems', () => {
  it('reads every id of every open row and ignores the navigation table', () => {
    const items = parseOpenItems(ROOT_TEXT)
    expect(items.map((i) => i.id)).toEqual(['1021', '1076', '1076-1', '198', '199', '200'])
    expect(items[0].status.startsWith('⏳')).toBe(true)
  })
})

describe('parseArchiveIds', () => {
  it('counts table rows only and keeps letter-prefixed ids', () => {
    const ids = parseArchiveIds(ARCHIVE_TEXT)
    expect(ids.get('1076')).toBe(1)
    expect(ids.get('G13')).toBe(1)
    expect([...ids.keys()].sort()).toEqual(['1021', '1076', '1076-1', '198', '199', '200', 'G13'].sort())
  })
})

describe('parseReadme', () => {
  it('collects registered files and indexed ids', () => {
    const { files, ids } = parseReadme(README_TEXT)
    expect([...files]).toEqual(['按批记录-2026-11.md'])
    expect(ids.has('1076-1')).toBe(true)
  })
})

describe('evaluate', () => {
  const ok = {
    rootText: ROOT_TEXT,
    archives: archivesOf([['按批记录-2026-11.md', ARCHIVE_TEXT]]),
    readmeText: README_TEXT,
  }

  it('passes a consistent trio', () => {
    expect(evaluate(ok).problems).toEqual([])
  })

  it('fails when the open table still contains a done row', () => {
    const rootText = ROOT_TEXT.replace('⏳ 超标', '✅ 已完成')
    const { problems } = evaluate({ ...ok, rootText })
    expect(problems.join('\n')).toContain('未结项表里出现 ✅')
  })

  it('fails when an open id has no archive record', () => {
    const rootText = ROOT_TEXT.replace('| **1021** |', '| **9999** |')
    const { problems } = evaluate({ ...ok, rootText })
    expect(problems.join('\n')).toContain('归档里不存在的编号：9999')
  })

  it('fails when an archive file is missing from the index', () => {
    const archives = archivesOf([
      ['按批记录-2026-11.md', ARCHIVE_TEXT],
      ['按批记录-2026-12.md', '| # | 需求 |\n| --- | --- |\n| **2000** | x |'],
    ])
    const { problems } = evaluate({ ...ok, archives })
    expect(problems.join('\n')).toContain('归档文件没在索引里登记：ledger/按批记录-2026-12.md')
  })

  it('fails when the index points at a file that does not exist', () => {
    const readmeText = `${README_TEXT}\n| \`ledger/按批记录-2020-01.md\` | 旧 | 1 | 1 |`
    const { problems } = evaluate({ ...ok, readmeText })
    expect(problems.join('\n')).toContain('不存在的归档文件')
  })

  it('fails when an archived id is missing from the index', () => {
    const readmeText = README_TEXT.replace('· #G13', '')
    const { problems } = evaluate({ ...ok, readmeText })
    expect(problems.join('\n')).toContain('归档里有、索引里没有的编号：#G13')
  })

  it('fails when the index lists an id with no archived row', () => {
    const readmeText = `${README_TEXT}\n#7777`
    const { problems } = evaluate({ ...ok, readmeText })
    expect(problems.join('\n')).toContain('索引里有、归档里没有的编号：#7777')
  })
})

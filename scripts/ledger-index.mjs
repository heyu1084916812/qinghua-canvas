/**
 * 对账归档索引生成器：把 `ledger/` 里现有的归档文件扫一遍，重写 `ledger/README.md`。
 *
 * 为什么要单独一个脚本：拆分时生成的索引会随着「每月新增归档文件 / 每月追加新段」而过期。
 * 索引一旦过期，`check-ledger.mjs` 会报「归档里有、索引里没有的编号」，而那时的修法
 * 不该是手工补一张表（必然漏），而是**重跑这个脚本**。
 *
 * 读：`ledger/*.md`（除 README 本身）
 * 写：`ledger/README.md`（导航表 + 每份文件里的编号清单 + 跨文件编号表）
 *
 * 用法：node scripts/ledger-index.mjs [--check]
 *   `--check` 只比对，不写盘（`npm run check` 用的是 check-ledger.mjs 的语义判据，不用这个）。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { idTokensOf } from './check-ledger.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIR = join(ROOT, 'ledger')

/** 一份归档文件的标题（取第一个 `# ` 行）与段数（`## ` 行数） */
function describe(text) {
  const lines = text.split(/\r?\n/)
  const title = (lines.find((l) => l.startsWith('# ')) ?? '# (无标题)').replace(/^#\s*/, '')
  const sections = lines.filter((l) => /^##\s+/.test(l)).length
  return { title, sections, lines: lines[lines.length - 1] === '' ? lines.length - 1 : lines.length }
}

/** 一份归档文件里的编号（只统计表格行的第一格） */
export function idsInArchive(text) {
  const map = new Map()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').map((s) => s.trim()).slice(1, -1)
    for (const id of idTokensOf(cells[0])) map.set(id, (map.get(id) ?? 0) + 1)
  }
  return map
}

const numOf = (id) => Number((id.match(/\d+/) ?? ['0'])[0])
const sortId = (a, b) => numOf(a) - numOf(b) || a.localeCompare(b)

function wrapIds(ids, perLine = 12) {
  const out = []
  for (let i = 0; i < ids.length; i += perLine) {
    out.push(ids.slice(i, i + perLine).map((id) => `#${id}`).join(' · '))
  }
  return out
}

/**
 * 纯函数：`[{ file, text }]` → README 文本。
 * 单独导出是为了让测试能钉住格式（check-ledger 依赖这些格式）。
 */
export function buildIndex(entries) {
  const files = entries
    .map(({ file, text }) => ({ file, ...describe(text), ids: idsInArchive(text) }))
    .sort((a, b) => a.file.localeCompare(b.file))

  const rows = new Map() // id -> { files:Set, rows }
  for (const f of files) {
    for (const [id, count] of f.ids) {
      if (!rows.has(id)) rows.set(id, { files: new Set(), rows: 0 })
      const e = rows.get(id)
      e.files.add(f.file)
      e.rows += count
    }
  }
  const allIds = [...rows.keys()].sort(sortId)
  const multi = [...rows.entries()].filter(([, e]) => e.files.size > 1).sort((a, b) => sortId(a[0], b[0]))

  const out = [
    '# 轻画 · 对账归档索引',
    '',
    '> 《轻画-功能对账清单.md》在 2026-11-14 拆成三部分：',
    '> ① 根目录清单 = 图例 + **当前未结项** + 维护规则（只留正在办的事）；',
    '> ② 本目录 = 历史逐批记录与已结项证据（**原文逐字保留**）；',
    '> ③ 本文件 = 编号 → 归档文件的定位表（只指路，不复制状态）。',
    '',
    '**本文件由 `node scripts/ledger-index.mjs` 生成，不要手改**（手改必漏；重跑脚本即可）。',
    '**怎么查某个编号**：在本文件查到它在哪个文件，再 `rg -n "#编号" ledger/`。',
    '**判定规则不变**：一个编号常有多条状态行（多轮复跑），**以最后一条为准**。',
    '',
    '## 一、归档文件',
    '',
    '| 文件 | 装什么 | 段数 | 行数 |',
    '| --- | --- | --- | --- |',
    ...files.map((f) => `| \`ledger/${f.file}\` | ${f.title} | ${f.sections} | ${f.lines} |`),
    '',
    '## 二、每个归档文件里有哪些编号',
    '',
  ]
  for (const f of files) {
    const ids = [...f.ids.keys()].sort(sortId)
    out.push(`**ledger/${f.file}**（${ids.length} 个编号）`, '', ...wrapIds(ids), '')
  }

  out.push('## 三、跨多个文件的编号（同一条需求在几批里复跑过）', '')
  out.push('| 编号 | 文件 | 状态行 |', '| --- | --- | --- |')
  for (const [id, e] of multi) {
    out.push(`| #${id} | ${[...e.files].sort().map((x) => `\`${x}\``).join(' · ')} | ${e.rows} |`)
  }
  out.push(
    '',
    '---',
    '',
    '## 四、维护规则（归档侧）',
    '',
    '1. **历史文件只读**：已经归档的月份文件，**已有段落一字不改**；当月要补记录就在该文件末尾追加新的 `##` 段；',
    '2. **跨月就换文件**：下个月一律新建 `按批记录-YYYY-MM.md`（不是往旧文件里塞）；',
    '3. **编号全局唯一、不复用**：已结项的编号留在归档里，新需求取新号；',
    '4. **索引不复制状态**：本文件只指路；判「做没做」永远看归档里该编号的最新状态行；',
    '5. 机械校验：`node scripts/check-ledger.mjs`（已接进 `npm run check`）；索引过期就重跑 `node scripts/ledger-index.mjs`。',
    '',
  )
  return { text: out.join('\n'), fileCount: files.length, idCount: allIds.length, multiCount: multi.length }
}

function main() {
  const entries = readdirSync(DIR)
    .filter((n) => n.toLowerCase().endsWith('.md') && n !== 'README.md')
    .sort()
    .map((file) => ({ file, text: readFileSync(join(DIR, file), 'utf8') }))
  const { text, fileCount, idCount, multiCount } = buildIndex(entries)
  const target = join(DIR, 'README.md')
  if (process.argv.includes('--check')) {
    const current = readFileSync(target, 'utf8')
    if (current.trim() !== text.trim()) {
      console.error('✘ ledger/README.md 已过期：重跑 node scripts/ledger-index.mjs')
      process.exit(1)
    }
    console.log('✔ ledger/README.md 是最新的')
    return
  }
  writeFileSync(target, text, 'utf8')
  console.log(
    `✔ ledger/README.md 已重建：${fileCount} 份归档 / ${idCount} 个编号 / 跨文件 ${multiCount} 个`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()

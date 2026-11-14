/**
 * 对账清单结构闸门（防「拆完又长回去」「索引和归档对不上」）。
 *
 * 背景（2026-11-14）：原《轻画-功能对账清单.md》2497 KB / 10721 行 / 869 个编号，
 * 「现在要办的 30 来行」埋在 1 万多行已完成记录里 —— 人和 AI 每次开工都得先 grep。
 * 拆分方案：根目录只留「当前未结项 + 图例 + 规则」，历史逐批记录进 `ledger/`（原文逐字保留），
 * 外加 `ledger/README.md` 做编号 → 文件的索引。
 *
 * 拆一次不难，难的是**别让它再长回去**。这个脚本钉住五条：
 * ① 根清单的「未结项」里**不许出现 ✅**（已交付的必须挪进归档，否则根文件又会长胖）；
 * ② 根清单里写的每个编号，**必须在 `ledger/` 里真有一行**（防凭空造号 / 编号写错）；
 * ③ `ledger/` 下的每份 `.md`（除 README 本身）**必须在 README 的归档文件表里登记**；
 * ④ README 索引里的每个编号**必须真在某个归档文件里有行**；
 * ⑤ 归档里出现的每个编号**必须在 README 索引里出现**（否则以后查不到）。
 *
 * 用法：node scripts/check-ledger.mjs
 * 已接进 `npm run check`。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const LEDGER = '轻画-功能对账清单.md'
export const ARCHIVE_DIR = 'ledger'
export const ARCHIVE_INDEX = 'ledger/README.md'

/** 表格里「编号」那一格的合法写法：纯数字（可带 a/b 后缀与 -1/-2 分档），或 W4 / S2 这种字母前缀编号 */
const ID_CELL = /^(?:\d{1,4}[a-z]?|[A-Z]\d{1,3})(-\d+)?$/
const MARK = /^[✅📝🧩⏳🚧❌🔍]/u

/** 表格行 → 单元格数组（首尾空串已去掉） */
function cellsOf(line) {
  const cells = line.split('|').map((s) => s.trim())
  // "| a | b |" → ["", "a", "b", ""]
  return cells.slice(1, cells.length - 1)
}

/**
 * 「编号格」→ 编号数组。一格可以挂多个编号（`**1076** / **1076-1**`），
 * 但只要出现任何一个不像编号的片段就整行不认 —— 这样「归档导航」那种列路径的表不会被误判成编号行。
 */
export function idTokensOf(cell) {
  const raw = (cell ?? '').replace(/[*`]/g, '').trim()
  if (!raw) return []
  const out = []
  for (const part of raw.split(/[\s/·、,]+/).filter(Boolean)) {
    // `198–200` / `203-208` 这种范围写法展开成单个编号
    const range = part.match(/^(\d{1,4})\s*[–—~-]\s*(\d{1,4})$/)
    if (range) {
      const [, a, b] = range
      const from = Number(a)
      const to = Number(b)
      if (to >= from && to - from <= 50) {
        for (let i = from; i <= to; i += 1) out.push(String(i))
        continue
      }
    }
    if (!ID_CELL.test(part)) return []
    out.push(part)
  }
  return [...new Set(out)]
}

/** 根清单：找出「未结项」表里每一行的编号与状态（一行可以挂多个编号，如 `**1076** / **1076-1**`） */
export function parseOpenItems(text) {
  const items = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue
    const cells = cellsOf(line)
    const ids = idTokensOf(cells[0])
    if (ids.length === 0) continue
    const status = cells.slice(1).find((c) => MARK.test(c)) ?? ''
    for (const id of ids) items.push({ id, status })
  }
  return items
}

/** 归档文件：只统计**表格行**里的编号（正文里的「见 #123」不算条目） */
export function parseArchiveIds(text) {
  const ids = new Map()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue
    for (const id of idTokensOf(cellsOf(line)[0])) {
      ids.set(id, (ids.get(id) ?? 0) + 1)
    }
  }
  return ids
}

/** README：登记的归档文件 + 索引里的编号 */
export function parseReadme(text) {
  const files = new Set()
  const ids = new Set()
  for (const line of text.split(/\r?\n/)) {
    for (const m of line.matchAll(/`ledger\/([^`]+\.md)`/g)) files.add(m[1])
    for (const m of line.matchAll(/#((?:\d{1,4}[a-z]?|[A-Z]\d{1,3})(?:-\d+)?)/g)) ids.add(m[1])
  }
  files.delete('README.md')
  return { files, ids }
}

/**
 * 纯函数判定。
 * @param {{rootText: string, archives: Map<string,string>, readmeText: string}} input
 */
export function evaluate({ rootText, archives, readmeText }) {
  const problems = []
  const openItems = parseOpenItems(rootText)
  const readme = parseReadme(readmeText)

  const archiveIds = new Map()
  for (const text of archives.values()) {
    for (const [id, count] of parseArchiveIds(text)) {
      archiveIds.set(id, (archiveIds.get(id) ?? 0) + count)
    }
  }

  /** ① 未结项里不许有 ✅ */
  for (const item of openItems) {
    if (item.status.startsWith('✅')) {
      problems.push(
        `未结项表里出现 ✅：编号 ${item.id} —— 已交付的行必须挪进 ${ARCHIVE_DIR}/按批记录-<当月>.md，` +
          `根清单只留没做完的事。`,
      )
    }
  }

  /** ② 未结项里的编号必须在归档里真有一行 */
  for (const item of new Set(openItems.map((i) => i.id.split('-')[0]))) {
    if (!archiveIds.has(item)) {
      problems.push(
        `未结项引用了归档里不存在的编号：${item} —— 要么在 ${ARCHIVE_DIR}/ 里补上它的记录，要么删掉这一行。`,
      )
    }
  }

  /** ③ 归档文件都要在 README 登记 */
  for (const file of archives.keys()) {
    if (!readme.files.has(file)) {
      problems.push(`归档文件没在索引里登记：${ARCHIVE_DIR}/${file} —— 在 ${ARCHIVE_INDEX} §一 的表里加一行。`)
    }
  }

  /** ④ README 登记的文件都要存在（文件缺失由调用方保证 archives 与磁盘一致） */
  for (const file of readme.files) {
    if (!archives.has(file)) {
      problems.push(`索引里登记了不存在的归档文件：${ARCHIVE_DIR}/${file} —— 文件被改名 / 删掉了，同步索引。`)
    }
  }

  /** ⑤ 两边编号集合必须一致 */
  for (const id of archiveIds.keys()) {
    if (!readme.ids.has(id)) {
      problems.push(
        `归档里有、索引里没有的编号：#${id} —— 重跑拆分脚本或在 ${ARCHIVE_INDEX} 的编号清单里补上。`,
      )
    }
  }
  for (const id of readme.ids) {
    if (!archiveIds.has(id)) {
      problems.push(`索引里有、归档里没有的编号：#${id} —— 索引写错了，或那一行被误删。`)
    }
  }

  return { problems, openItems, archiveIdCount: archiveIds.size, readmeIdCount: readme.ids.size }
}

function main() {
  const rootPath = join(ROOT, LEDGER)
  if (!existsSync(rootPath)) {
    console.error(`✘ 找不到对账清单：${LEDGER}`)
    process.exit(1)
  }
  const rootText = readFileSync(rootPath, 'utf8')

  const dir = join(ROOT, ARCHIVE_DIR)
  const archives = new Map()
  for (const name of readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.md')).sort()) {
    if (name === 'README.md') continue
    archives.set(name, readFileSync(join(dir, name), 'utf8'))
  }

  const indexText = readFileSync(join(ROOT, ARCHIVE_INDEX), 'utf8')
  const { problems, openItems, archiveIdCount } = evaluate({ rootText, archives, readmeText: indexText })

  if (problems.length) {
    console.error(`✘ 对账清单结构不一致（${problems.length} 处）`)
    for (const p of problems) console.error(`    - ${p}`)
    console.error(
      '\n判据：根清单只装「还没做完的事」；历史与证据在 ledger/；两边靠编号互相对应。',
    )
    process.exit(1)
  }

  const MARKERS = [
    ['📝', '仅设计'],
    ['🧩', '部分'],
    ['⏳', '推迟'],
    ['🚧', '在改'],
    ['❌', '有缺陷'],
    ['🔍', '待验收'],
    ['✅', '已完成'],
  ]
  const shape = MARKERS.map(([marker, label]) => [label, openItems.filter((i) => i.status.startsWith(marker)).length])
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label} ${n}`)
    .join(' / ')
  console.log(
    `✔ 对账清单结构通过：未结项 ${openItems.length} 行（${shape}）/ ` +
      `归档 ${archives.size} 份共 ${archiveIdCount} 个编号 / 索引与归档一一对应`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()

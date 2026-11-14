/**
 * 文档体积闸门（防「文档越写越大、没人愿意读」）。
 *
 * 背景：2026-11-14 用户提出「现在的各种文档偏大，有什么办法解决」。实测当时：
 * `轻画-功能对账清单.md` 2497 KB / 10721 行、`轻画-产品设计文档.md` 486 KB / 4513 行、
 * `轻画-架构设计文档.md` 470 KB / 4968 行、`RELEASE_NOTES.md` 192 KB / 1378 行、
 * `.workbuddy/memory/MEMORY.md` 1254 KB / 12964 行。
 *
 * 光拆一次没用 —— 拆完还会再长回去。这个脚本只做一件事：**给每份文档钉一个行数上限，
 * 超了就报错**，逼新内容写进子文件（`ledger/`、`release-notes/`、`docs/` 等），
 * 而不是继续往同一份文件尾巴上追加。
 *
 * 三档判据：
 * ① `BUDGET`：已经拆分过的文档的**目标**行数（硬上限）；
 * ② `LEGACY`：还没拆的存量文档的**冻结基线**（只许变短，不许变长）；
 * ③ 没登记的文件：按 `DEFAULT_BUDGET`（新文档一律从小开始写）。
 *
 * 也就是说：**想加内容 → 要么删旧的，要么另开一个文件。** 这是刻意的摩擦。
 *
 * 用法：node scripts/check-doc-size.mjs [--report]
 * 已接进 `npm run check`。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 未登记的新文档上限（行）。新文件从小写起，自然按主题拆开。 */
export const DEFAULT_BUDGET = 800

/** 单行长度上限：整行上万字符的表格行没人读得下去，也会让 diff 失真。 */
export const MAX_LINE_CHARS = 12000

/**
 * 存量文档冻结基线（2026-11-14 实测值，用本脚本同一套计数口径）。
 * 拆分完成后把对应行**降下来**，不要在这里加新行。
 */
export const LEGACY = {
  '轻画-工作台解耦与公共能力重构方案.md': 1354,
  '轻画-Agent设计文档.md': 1259,
  '轻画-画布引擎替换方案.md': 891,
  '轻画-桌面封装方案.md': 720,
  '轻画-存储V2架构与迁移方案.md': 519,
  '轻画-漫剧形态调研.md': 510,
  '轻画-路由-Agent-记忆系统统一规划.md': 463,
  '轻画-市场调研与差异化定位.md': 394,
  '轻画-项目导航与电商工作台重构设计.md': 321,
  '轻画-开发计划.md': 301,
  '轻画-电商与插件设计.md': 280,
  '轻画-电商无限工作台与素材管理设计.md': 275,
  '轻画-渠道多分组与模型管理设计.md': 270,
  '轻画-交付功能与设置梳理.md': 252,
  '轻画-设置页清单与稿子.md': 250,
  '轻画-方向调研与可行性判断.md': 197,
  '文档总索引.md': 217,
  '轻画-下一步实施设计.md': 187,
  '轻画-电商参数区一比一复刻设计.md': 141,
  '轻画-图标统一方案.md': 140,
  'README.md': 128,
  'PRODUCT.md': 65,
  'AGENTS.md': 46,
  // 对账归档（2026-11-14 拆分时定版）。归档只读：新记录写进新的月份文件，不改旧的。
  'ledger/README.md': 207,
  'ledger/01-产品文档对账与专题.md': 331,
  'ledger/02-缺口汇总主表.md': 1471,
  'ledger/按批记录-2026-09.md': 625,
  'ledger/按批记录-2026-10.md': 5141,
  'ledger/按批记录-2026-11.md': 3226,
  // 发行说明：一个版本一篇（2026-11-14 拆分）。旧版本文件只读。
  'release-notes/archive-0.1.0-and-earlier.md': 900,
  'release-notes/v0.1.1.md': 34,
  'release-notes/v0.1.2.md': 36,
  'release-notes/v0.1.3.md': 18,
  'release-notes/v0.1.4.md': 35,
  'release-notes/v0.1.6.md': 26,
  'release-notes/v0.1.7.md': 30,
  'release-notes/v0.1.8.md': 28,
  'release-notes/v0.1.9.md': 33,
  'release-notes/v0.1.10.md': 26,
  'release-notes/v0.1.11.md': 20,
  'release-notes/v0.1.12.md': 28,
  'release-notes/v0.1.13.md': 31,
  'release-notes/v0.1.14.md': 56,
  'release-notes/v0.1.16.md': 33,
  'release-notes/v0.1.17.md': 46,
  // 项目记忆（2026-11-14 拆分）：MEMORY.md 只留索引，必读四节在 ESSENTIALS，历史按月归档。
  '.workbuddy/memory/2026-09-04.md': 223,
  '.workbuddy/memory/2026-09-05.md': 56,
  '.workbuddy/memory/2026-09-06.md': 77,
  '.workbuddy/memory/2026-09-08.md': 39,
  '.workbuddy/memory/2026-09-09.md': 86,
  '.workbuddy/memory/2026-09-10.md': 185,
  '.workbuddy/memory/2026-09-11.md': 507,
  '.workbuddy/memory/2026-09-12.md': 777,
  '.workbuddy/memory/2026-09-13.md': 108,
  '.workbuddy/memory/2026-09-14.md': 171,
  '.workbuddy/memory/2026-09-15.md': 186,
  '.workbuddy/memory/ESSENTIALS.md': 3735,
  '.workbuddy/memory/INVARIANTS.md': 1217,
  '.workbuddy/memory/archive/2026-09.md': 290,
  '.workbuddy/memory/archive/2026-10.md': 6903,
  '.workbuddy/memory/archive/2026-11.md': 2067,
}

/**
 * 已拆分文档的目标上限。拆分完成的文件在这里登记，基线从 `LEGACY` 移过来。
 */
export const BUDGET = {
  // 拆分后只剩「未结项 + 图例 + 规则」；历史在 ledger/。
  '轻画-功能对账清单.md': 400,
  // 拆分后只剩「版本索引 + 写新版本说明的规矩」；每个版本在 release-notes/。
  'RELEASE_NOTES.md': 200,
  // 拆分后只剩索引；必读四节在 ESSENTIALS.md，历史在 .workbuddy/memory/archive/。
  '.workbuddy/memory/MEMORY.md': 300,
  // 拆分后只剩「哪条 § 在哪份文件」的索引；正文在 docs/product/、docs/arch/（每份 ≤800 行）。
  '轻画-产品设计文档.md': 300,
  '轻画-架构设计文档.md': 300,
}

/** 递归收集文档：根目录 + 这几个目录及其子目录（`review/` 等一次性证据目录不进闸门）。 */
const TRACKED_SUBDIRS = ['ledger', 'release-notes', 'docs', '.workbuddy/memory']

/** rel 是否落在受管目录里（或是受管目录的祖先，需要继续往下走） */
const tracked = (rel) =>
  TRACKED_SUBDIRS.some((t) => rel === t || rel.startsWith(`${t}/`) || t.startsWith(`${rel}/`))

/** 纯函数：文本 → { lineCount, maxLine, maxLineNo }（末尾换行不计行） */
export function measureText(text) {
  const lines = text.split(/\r?\n/)
  const lineCount = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
  let maxLine = 0
  let maxLineNo = 0
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].length > maxLine) {
      maxLine = lines[i].length
      maxLineNo = i + 1
    }
  }
  return { lineCount, maxLine, maxLineNo }
}

/** 纯函数：某个文档适用的上限与来源 */
export function limitsFor(rel) {
  if (BUDGET[rel] !== undefined) return { limit: BUDGET[rel], kind: '目标' }
  if (LEGACY[rel] !== undefined) return { limit: LEGACY[rel], kind: '冻结基线' }
  return { limit: DEFAULT_BUDGET, kind: '默认' }
}

/** 纯函数：单份文档的判定 → 问题数组（空数组 = 通过） */
export function judgeDoc({ rel, bytes, lineCount, maxLine, maxLineNo }) {
  const problems = []
  const { limit, kind } = limitsFor(rel)
  if (lineCount > limit) {
    problems.push(
      `${rel}：${lineCount} 行 > ${kind} ${limit} 行（超 ${lineCount - limit} 行，${Math.round(bytes / 1024)} KB）` +
        `\n      处理：把新内容写进新的子文件（ledger/ · release-notes/ · docs/），` +
        `或把已经交付 / 过期的段落移进归档。文档只加不改的旧习就到此为止。`,
    )
  }
  if (maxLine > MAX_LINE_CHARS) {
    problems.push(
      `${rel}：第 ${maxLineNo} 行有 ${maxLine} 字符 > ${MAX_LINE_CHARS}` +
        `\n      处理：把这一行（通常是整段塞进一个表格单元）拆成多行或另起小节。`,
    )
  }
  return problems
}

function walk(dir, out = []) {
  const abs = dir ? join(ROOT, dir) : ROOT
  let entries
  try {
    entries = readdirSync(abs, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const rel = dir ? `${dir}/${e.name}` : e.name
    if (e.isDirectory()) {
      if (tracked(rel)) walk(rel, out)
      continue
    }
    if (e.name.toLowerCase().endsWith('.md')) out.push(rel)
  }
  out.sort()
  return out
}

function readDoc(rel) {
  const abs = join(ROOT, rel)
  const text = readFileSync(abs, 'utf8')
  return { rel, bytes: statSync(abs).size, ...measureText(text) }
}

function main() {
  const report = walk('').map(readDoc)
  if (process.argv.includes('--report')) {
    const pad = (s, n) => String(s).padStart(n)
    for (const m of [...report].sort((a, b) => b.lineCount - a.lineCount)) {
      const { limit, kind } = limitsFor(m.rel)
      console.log(
        `${pad(m.lineCount, 6)}/${pad(limit, 6)} 行 ${pad(Math.round(m.bytes / 1024), 6)} KB  ` +
          `${pad(m.maxLine, 5)} 最长行  [${kind}] ${m.rel}`,
      )
    }
    console.log(
      `\n共 ${report.length} 份文档 / ${report.reduce((s, m) => s + m.lineCount, 0)} 行`,
    )
    return
  }

  const problems = report.flatMap(judgeDoc)
  if (problems.length) {
    console.error(`✘ 文档体积超限（${problems.length} 处）`)
    for (const p of problems) console.error(`    - ${p}`)
    console.error('\n判据：每份文档「谁负责哪一块」要能一眼看完；超限就拆文件，不要继续追加。')
    process.exit(1)
  }
  console.log(
    `✔ 文档体积闸门通过：${report.length} 份文档 / ` +
      `共 ${report.reduce((s, m) => s + m.lineCount, 0)} 行 / ` +
      `最大单行 ${Math.max(...report.map((m) => m.maxLine))} 字符`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()

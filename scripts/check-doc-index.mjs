/**
 * 文档索引覆盖检查（防"文档越写越多、没人知道哪份算数"）。
 *
 * 背景：仓库根目录已有 27 份 markdown。曾出现两处真实冲突：
 * ① 两份"计划"对同一件事说法不同；② 漫剧口径与既有调研不一致。
 * 处理原则是**不删不合并**，靠 `文档总索引.md` 登记"谁管什么"。
 * 但索引本身也会过期 —— 新增了文档却忘了登记，索引就变成假真相。
 *
 * 2026-11-14 起支持**分卷子目录**（`docs/product/`、`docs/arch/`）：
 * - 根目录的 `.md` 仍逐一按文件名登记；
 * - 子目录允许**按目录登记**（索引里写 `` `docs/product/` ``），目录下每个 `.md` 都算已登记；
 * - 也允许把子目录里的单个文件写全路径登记。
 *
 * 判据：
 * ① 根目录每个 `.md` 必须被登记；
 * ② 被扫描子目录里的每个 `.md` 必须被「目录登记」或「文件登记」覆盖；
 * ③ 登记了但文件 / 目录不存在的，报错（改名或删掉忘了同步）。
 *
 * 用法：node scripts/check-doc-index.mjs
 * 已接入 `npm run check`（与主题守卫、壳几何同层）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const INDEX = '文档总索引.md'

/** 参与覆盖检查的分卷目录（相对仓库根，结尾不带 `/`） */
export const SCANNED_DIRS = ['docs']

/** 递归列出某个目录下的 markdown（相对路径，正斜杠） */
function listMarkdown(relDir, out = []) {
  const abs = join(ROOT, relDir)
  if (!existsSync(abs)) return out
  for (const e of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = `${relDir}/${e.name}`
    if (e.isDirectory()) listMarkdown(rel, out)
    else if (e.name.toLowerCase().endsWith('.md')) out.push(rel)
  }
  return out
}

/**
 * 解析索引里的登记：`name.md` 记根文件，`path/` 记整个目录。
 * 只认行内代码，避免正文提到文件名时误判；
 * 含 `<…>` / `YYYY` / `当月` 这类**占位写法**的不算登记（它们是规则里的模板，不是文件）。
 */
export function parseRegistrations(indexText) {
  const PLACEHOLDER = /[<>]|YYYY|当月|版本号|…/
  const files = new Set()
  const dirs = new Set()
  for (const m of indexText.matchAll(/`([^`\\]+)`/g)) {
    const token = m[1].trim()
    if (PLACEHOLDER.test(token)) continue
    if (token.endsWith('/')) {
      // 只认「至少两层」的目录登记（`docs/product/`）；裸 `docs/` 这种一句话提到不算，
      // 否则正文里随手写个 `docs/` 就把整个子树静默登记了。
      const dirPath = token.replace(/\/+$/, '')
      if (dirPath.split('/').filter(Boolean).length >= 2) dirs.add(dirPath)
      continue
    }
    // 至少要有「文件名 + .md」四层字符，`.md` 这种泛称不算
    if (!/[^/\\]\.md$/i.test(token)) continue
    files.add(token)
  }
  return { files, dirs }
}

/**
 * 纯函数判定：actual 是全仓库受管文档的相对路径列表（根文件用裸名，子目录用 `docs/...`）。
 * @returns {{missing: string[], stale: string[], rootCount: number, subCount: number}}
 */
export function evaluateIndex({ actual, indexText }) {
  const { files, dirs } = parseRegistrations(indexText)
  const rootFiles = actual.filter((p) => !p.includes('/'))
  const subFiles = actual.filter((p) => p.includes('/'))

  const covered = (rel) => files.has(rel) || [...dirs].some((d) => rel.startsWith(`${d}/`))
  const missing = actual.filter((rel) => !covered(rel)).sort()

  const stale = []
  for (const f of files) {
    // 只有「看起来是仓库内路径」的登记才要求文件存在；裸名按根目录校验
    if (!existsSync(join(ROOT, f))) stale.push(f)
  }
  for (const d of dirs) {
    const abs = join(ROOT, d)
    if (!existsSync(abs) || !statSync(abs).isDirectory()) stale.push(`${d}/`)
    else if (listMarkdown(d).length === 0) stale.push(`${d}/（目录里没有 .md）`)
  }

  return { missing, stale: [...new Set(stale)].sort(), rootCount: rootFiles.length, subCount: subFiles.length }
}

function main() {
  const actual = [
    ...readdirSync(ROOT, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
      .map((e) => e.name),
    ...SCANNED_DIRS.flatMap((d) => listMarkdown(d)),
  ].sort()
  const indexText = readFileSync(join(ROOT, INDEX), 'utf8')
  const { missing, stale, rootCount, subCount } = evaluateIndex({ actual, indexText })

  if (missing.length === 0 && stale.length === 0) {
    console.log(
      `✔ 文档索引覆盖通过：根目录 ${rootCount} 份 + 分卷目录 ${subCount} 份 .md 全部已登记`,
    )
    return
  }

  console.error(`✘ 文档索引不一致（根目录 ${rootCount} 份 + 分卷目录 ${subCount} 份）`)
  if (missing.length) {
    console.error('  未登记的文档（新增后忘了写进《文档总索引.md》）：')
    for (const name of missing) console.error(`    - ${name}`)
  }
  if (stale.length) {
    console.error('  索引里登记了、但文件 / 目录不在（可能被改名或删除）：')
    for (const name of stale) console.error(`    - ${name}`)
  }
  console.error(
    '\n处理：在《文档总索引.md》§二（根目录）或 §2.1（分卷子目录）补一行 / 改一行，再重跑。',
  )
  process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()

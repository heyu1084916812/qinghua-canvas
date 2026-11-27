/**
 * 清理本地验证与探针临时产物（`.playwright-verify/`、`.probe-tmp/`、根目录 `.tmp-*`/`.probe-*`/`.tauri-dev*`/`.devserver*`）。
 *
 * 用法：
 *   node scripts/clean-verify.mjs [--dry-run] [--keep=agent-e2e-20261127] [--days=7]
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ROOT_TEMP_FILE = /^\.(?:tmp-|probe-|tauri-dev|devserver)/

/** 判定根目录文件名是否属于可清理的本地临时转储 / 日志文件 */
export function isRootTempFile(name) {
  return ROOT_TEMP_FILE.test(name)
}

/**
 * 纯函数：从目录条目中选出应删除的名称列表。
 * @param {Array<{name: string, mtimeMs: number}>} entries
 * @param {{keep?: Iterable<string>, maxAgeDays?: number, nowMs?: number}} [options]
 */
export function selectCleanTargets(entries, options = {}) {
  const keepSet = new Set(options.keep ?? [])
  const maxAgeDays = options.maxAgeDays ?? 0
  const nowMs = options.nowMs ?? Date.now()
  const cutoffMs = maxAgeDays > 0 ? nowMs - maxAgeDays * 24 * 60 * 60 * 1000 : Number.POSITIVE_INFINITY

  return entries
    .filter((entry) => !keepSet.has(entry.name) && entry.mtimeMs <= cutoffMs)
    .map((entry) => entry.name)
    .sort()
}

/** 解析命令行参数 */
export function parseArgs(argv) {
  let dryRun = false
  let maxAgeDays = 0
  const keep = []

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg.startsWith('--keep=')) {
      for (const item of arg.slice('--keep='.length).split(',')) {
        const trimmed = item.trim()
        if (trimmed) keep.push(trimmed)
      }
    } else if (arg.startsWith('--days=')) {
      const parsed = Number(arg.slice('--days='.length))
      if (Number.isFinite(parsed) && parsed >= 0) maxAgeDays = parsed
    }
  }

  return { dryRun, maxAgeDays, keep }
}

function cleanVerifyDir(verifyDir, options) {
  if (!existsSync(verifyDir)) return []
  const entries = readdirSync(verifyDir).map((name) => {
    const fullPath = join(verifyDir, name)
    let mtimeMs = 0
    try {
      mtimeMs = statSync(fullPath).mtimeMs
    } catch {
      mtimeMs = 0
    }
    return { name, mtimeMs }
  })
  const targets = selectCleanTargets(entries, options)
  if (!options.dryRun) {
    for (const name of targets) {
      rmSync(join(verifyDir, name), { recursive: true, force: true })
    }
  }
  return targets
}

function main() {
  const { dryRun, maxAgeDays, keep } = parseArgs(process.argv.slice(2))
  const verifyDir = join(ROOT, '.playwright-verify')
  const probeTmpDir = join(ROOT, '.probe-tmp')

  const verifyTargets = cleanVerifyDir(verifyDir, { dryRun, maxAgeDays, keep })
  const probeRemoved = existsSync(probeTmpDir)
  if (probeRemoved && !dryRun) {
    rmSync(probeTmpDir, { recursive: true, force: true })
  }

  const rootTempFiles = readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isRootTempFile(entry.name))
    .map((entry) => entry.name)
    .sort()
  if (!dryRun) {
    for (const name of rootTempFiles) {
      rmSync(join(ROOT, name), { force: true })
    }
  }

  const prefix = dryRun ? '[dry-run] ' : ''
  console.log(
    `${prefix}✔ clean:verify 完成：.playwright-verify 清理 ${verifyTargets.length} 项` +
      `（保留 ${keep.length} 个白名单），.probe-tmp ${probeRemoved ? '已清理' : '不存在'}，` +
      `根目录临时文件清理 ${rootTempFiles.length} 个`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()

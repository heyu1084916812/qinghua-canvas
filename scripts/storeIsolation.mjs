/**
 * 验收 / 冒烟 / 探针脚本的**隔离数据目录护栏**（对账 #1130 H4）。
 *
 * 事故（2026-11-14，68160065）：探针脚本直接驱动开发壳写共享存储，把用户真实的
 * RunningHub 工作流条目整行覆盖了，清理后只剩 `entries: []`，没有历史版本可回。
 * 所以凡是**会经页面或接口写库**的脚本，开写前先问 `/health` 的 `dataDir`：
 * 只允许系统临时目录、仓库 `.playwright-verify/` 下（smoke-matrix 每组自建的库），
 * 或 `QINGHUA_ISOLATED_ROOTS` 显式列出的根；其余一律拒绝。
 *
 * 确实要对真实库跑（例如用户本人要求复现）：显式设 `QINGHUA_ALLOW_SHARED_STORE=1`。
 * 一次性探针（`scripts/probe-*.mjs`，已 gitignore）也请 `import { assertIsolatedStore }` 后再动手。
 */
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

function inside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** 纯判定：`dataDir` 是不是隔离目录（导出给单测） */
export function isIsolatedDataDir(dataDir, env = process.env, tmpRoots = [os.tmpdir(), '/tmp']) {
  if (typeof dataDir !== 'string' || !dataDir.trim() || !path.isAbsolute(dataDir.trim())) return false
  const extra = String(env.QINGHUA_ISOLATED_ROOTS ?? '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter((item) => item && path.isAbsolute(item))
  const roots = [...tmpRoots, path.join(ROOT, '.playwright-verify'), ...extra]
  return roots.some((root) => inside(dataDir.trim(), root))
}

/** 开写前调用：`storeBase` 指向共享存储服务（默认开发壳的 18765） */
export async function assertIsolatedStore(storeBase = 'http://127.0.0.1:18765', env = process.env, fetchImpl = fetch) {
  if (env.QINGHUA_ALLOW_SHARED_STORE === '1') return { allowed: 'override' }
  let health
  try {
    health = await (await fetchImpl(`${String(storeBase).replace(/\/$/, '')}/health`)).json()
  } catch (error) {
    throw new Error(`读不到 ${storeBase}/health，无法确认数据目录是否隔离：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isIsolatedDataDir(health?.dataDir, env)) {
    throw new Error(
      `拒绝在非隔离数据目录上跑：${storeBase} 的 dataDir = ${health?.dataDir ?? '(未知)'}。` +
        '请用临时目录启动共享存储（例如 --data-dir /tmp/qh-xxx），或设 QINGHUA_ISOLATED_ROOTS；确需写真实库设 QINGHUA_ALLOW_SHARED_STORE=1。',
    )
  }
  return { allowed: 'isolated', dataDir: health.dataDir }
}

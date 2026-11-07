/**
 * 全局冒烟矩阵：每个组使用独立 LOCALAPPDATA/shared-store，避免组间数据污染。
 *
 * 用法：
 *   node scripts/smoke-matrix.mjs
 *   node scripts/smoke-matrix.mjs --start 0 --end 40
 *   node scripts/smoke-matrix.mjs g55 g95 g116
 */
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const SMOKE = path.join(ROOT, 'scripts/smoke.mjs')
const STORE_EXE = path.join(ROOT, 'shared-store/target/debug/qinghua-store.exe')
const OUT_ROOT = path.join(ROOT, '.playwright-verify/smoke-matrix')
const RUN = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const RUN_ROOT = path.join(OUT_ROOT, RUN)
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:1420'
const STORE_TIMEOUT_MS = Number(process.env.SMOKE_MATRIX_STORE_TIMEOUT_MS ?? 20_000)
const GROUP_TIMEOUT_MS = Number(process.env.SMOKE_MATRIX_GROUP_TIMEOUT_MS ?? 300_000)

/** 桌面 / 正常版 / release gate / MCP 已占用的端口，矩阵一律绕开。 */
export const RESERVED_PORTS = new Set([1420, 18765, 18766, 18791])
export const CRITICAL_SMOKE_GROUPS = ['g8', 'g44', 'g45', 'g74']
const MATRIX_BASE_PORT = Number(process.env.SMOKE_MATRIX_BASE_PORT ?? 18800)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 每组端口 = 基准端口 + 组下标。基准端口可由 SMOKE_MATRIX_BASE_PORT 覆盖，
 * 但禁止落到已知常驻端口；组间不同端口才能防止 store-start-failed 时误连上一组。
 */
export function groupPort(index, basePort = MATRIX_BASE_PORT) {
  const port = basePort + index
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`smoke matrix port out of range: ${port}`)
  }
  if (RESERVED_PORTS.has(port)) {
    throw new Error(
      `smoke matrix port ${port} conflicts with a reserved port; change SMOKE_MATRIX_BASE_PORT`,
    )
  }
  return port
}

export function groupPlan(index, root, basePort = MATRIX_BASE_PORT, group = 'group') {
  const port = groupPort(index, basePort)
  const groupRoot = path.join(root, `${String(index).padStart(3, '0')}-${group}`)
  const localAppData = path.join(groupRoot, 'localappdata')
  const dataDir = path.join(localAppData, 'com.qinghua.canvas', 'shared-store-v1')
  const storeBase = `http://127.0.0.1:${port}`
  return {
    index,
    groupRoot,
    localAppData,
    dataDir,
    port,
    storeBase,
    healthUrl: `${storeBase}/health`,
    storeArgs: ['--data-dir', dataDir, '--backend', 'v1', '--port', String(port)],
    smokeEnv: {
      SMOKE_STORE_BASE: storeBase,
    },
  }
}

export function healthOk(body, expectedDir) {
  return (
    body?.ok === true &&
    body?.version >= 5 &&
    body?.backend === 'json-v1' &&
    path.resolve(String(body.dataDir ?? '')) === path.resolve(expectedDir)
  )
}

export function parseSmokeSummary(logText) {
  const match = logText.match(
    /=====\s*(\d+)\s+passed\s*\/\s*(\d+)\s+failed\s*\/\s*(\d+)\s+total(?:\s*\/\s*(\d+)\s+external skipped)?\s*=====/,
  )
  if (!match) return { passed: null, failed: null, total: null, externalSkipped: null }
  return {
    passed: Number(match[1]),
    failed: Number(match[2]),
    total: Number(match[3]),
    externalSkipped: match[4] === undefined ? 0 : Number(match[4]),
  }
}

function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return
  spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
}

async function waitHealth(healthUrl, expectedDir) {
  const deadline = Date.now() + STORE_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl)
      if (response.ok) {
        const body = await response.json()
        if (healthOk(body, expectedDir)) {
          return true
        }
      }
    } catch {
      /* store 尚未启动 */
    }
    await sleep(150)
  }
  return false
}

export async function portReleased(port, deadlineMs = 5_000) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(250) })
      return false
    } catch {
      await sleep(100)
    }
  }
  return true
}

async function main() {
  if (!existsSync(STORE_EXE)) {
    console.error(`找不到 store: ${STORE_EXE}`)
    process.exit(1)
  }

  const smokeSource = readFileSync(SMOKE, 'utf8')
  const allGroupsMatch = smokeSource.match(/const ALL_GROUPS = \[([^\]]+)\]/)
  if (!allGroupsMatch) {
    console.error('无法从 scripts/smoke.mjs 解析 ALL_GROUPS')
    process.exit(1)
  }
  const allGroups = allGroupsMatch[1]
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  const args = process.argv.slice(2)
  let groups = allGroups
  if (args[0] === '--start' || args[0] === '--end') {
    const startIndex = args.includes('--start') ? Number(args[args.indexOf('--start') + 1]) : 0
    const endIndex = args.includes('--end') ? Number(args[args.indexOf('--end') + 1]) : allGroups.length
    groups = allGroups.slice(startIndex, endIndex)
  } else if (args.length > 0) {
    const requested = new Set(args)
    groups = allGroups.filter((group) => requested.has(group))
    const unknown = args.filter((group) => !allGroups.includes(group))
    if (unknown.length > 0) {
      console.error(`未知组: ${unknown.join(', ')}`)
      process.exit(1)
    }
  }
  if (groups.length === 0) {
    console.error('没有可运行的组')
    process.exit(1)
  }

  mkdirSync(RUN_ROOT, { recursive: true })
  const results = []
  const summaryPath = path.join(RUN_ROOT, 'summary.json')
  function writeSummary() {
    writeFileSync(summaryPath, JSON.stringify({ groups, results }, null, 2))
  }

  for (let index = 0; index < groups.length; index += 1) {
  const group = groups[index]
  const plan = groupPlan(index, RUN_ROOT, MATRIX_BASE_PORT, group)
  const groupRoot = plan.groupRoot
  mkdirSync(plan.localAppData, { recursive: true })
  const storeOut = path.join(groupRoot, 'store.out.log')
  const storeErr = path.join(groupRoot, 'store.err.log')
  const smokeLog = path.join(groupRoot, 'smoke.log')
  const store = spawn(STORE_EXE, plan.storeArgs, {
    cwd: ROOT,
    env: { ...process.env, LOCALAPPDATA: plan.localAppData },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const storeOutStream = createWriteStream(storeOut)
  const storeErrStream = createWriteStream(storeErr)
  store.stdout.pipe(storeOutStream)
  store.stderr.pipe(storeErrStream)

  const healthy = await waitHealth(plan.healthUrl, plan.dataDir)
  if (!healthy) {
    killTree(store)
    results.push({
      group,
      ok: false,
      reason: 'store-start-failed',
      log: smokeLog,
      elapsedMs: 0,
    })
    console.log(`FAIL ${group} store-start-failed`)
    continue
  }

  const startedAt = Date.now()
  const smoke = spawn(process.execPath, [SMOKE], {
    cwd: ROOT,
    env: {
      ...process.env,
      SMOKE_ONLY: group,
      SMOKE_BASE: BASE,
      ...plan.smokeEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const smokeStream = createWriteStream(smokeLog)
  smoke.stdout.pipe(smokeStream)
  smoke.stderr.pipe(smokeStream)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    killTree(smoke)
  }, GROUP_TIMEOUT_MS)
  const code = await new Promise((resolve) => {
    smoke.on('exit', (exitCode) => resolve(exitCode))
  })
  clearTimeout(timer)
  await new Promise((resolve) => smokeStream.end(resolve))
  killTree(store)
  const released = await portReleased(plan.port)

  const logText = readFileSync(smokeLog, 'utf8')
  const summary = parseSmokeSummary(logText)
  const result = {
    group,
    ok: code === 0 && !timedOut,
    code,
    timedOut,
    passed: summary.passed,
    failed: summary.failed,
    total: summary.total,
    externalSkipped: summary.externalSkipped,
    elapsedMs: Date.now() - startedAt,
    log: smokeLog,
    storeDir: plan.dataDir,
    port: plan.port,
    dataDir: plan.dataDir,
    storeBase: plan.storeBase,
  }
  if (!released) {
    result.ok = false
    result.reason = 'store-port-not-released'
  }
  results.push(result)
  writeSummary()
  console.log(
    `${result.ok ? 'PASS' : 'FAIL'} ${group} ${result.passed ?? '?'} / ${result.failed ?? '?'} / ${result.total ?? '?'} ${Math.round(result.elapsedMs / 1000)}s${timedOut ? ' TIMEOUT' : ''}`,
  )
}

writeSummary()
const failed = results.filter((result) => !result.ok)
console.log(`matrix done: ${results.length - failed.length}/${results.length} groups passed`)
console.log(`summary: ${summaryPath}`)
if (failed.length > 0) {
  console.log(`failed: ${failed.map((result) => result.group).join(', ')}`)
  process.exitCode = 1
}
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main()
}

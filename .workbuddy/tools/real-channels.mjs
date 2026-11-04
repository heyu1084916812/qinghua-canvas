import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'


const args = new Map(
  process.argv.slice(2).map((raw) => {
    const [key, ...rest] = raw.replace(/^--/, '').split('=')
    return [key, rest.join('=') || 'true']
  }),
)
const MODE = (args.get('mode') ?? 'workbuddy').toLowerCase()
if (!['workbuddy', 'chat2api'].includes(MODE)) {
  console.error('用法: node .workbuddy/tools/real-channels.mjs --mode=workbuddy|chat2api [--app=<exe>] [--out=<dir>] [--port=<n>] [--cdp-port=<n>] [--gateway-port=<n>] [--source-store=<url>]')
  process.exit(3)
}
const ROOT = path.resolve(import.meta.dirname, '../..')
const NOW = Date.now()
const STAMP = new Date(NOW).toISOString().replace(/[:.]/g, '-').slice(0, 19)
const OUT = path.resolve(args.get('out') ?? path.join(ROOT, '.playwright-verify', STAMP + '-real-channels-' + MODE))
const APP = path.resolve(args.get('app') ?? path.join(ROOT, 'src-tauri/target/release/qinghua.exe'))
const SOURCE_STORE = args.get('source-store') ?? 'http://127.0.0.1:28795'
const STORE_PORT = Number(args.get('port') ?? (MODE === 'chat2api' ? 18773 : 18778))
const CDP_PORT = Number(args.get('cdp-port') ?? (MODE === 'chat2api' ? 9351 : 9356))
const GATEWAY_PORT = String(args.get('gateway-port') ?? '28796')
const STORE = `http://127.0.0.1:${STORE_PORT}`
const DATA = path.join(OUT, 'data-v2')
const LOCAL_APPDATA = path.join(OUT, 'localappdata')
const PROFILE = path.join(OUT, 'webview2-profile')
const APP_LOG = path.join(OUT, 'app.log')
const RESULT_PATH = path.join(OUT, 'result.json')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function gitHead() {
  try {
    return spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
  } catch {
    return null
  }
}
const COMMIT = gitHead()


async function waitFor(fn, timeoutMs, label) {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < timeoutMs) {
    try { const value = await fn(); if (value) return value } catch (error) { lastError = error }
    await sleep(250)
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms${lastError ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ''}`)
}

async function jsonRequest(base, route, init = {}) {
  const response = await fetch(`${base}${route}`, {
    ...init,
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { throw new Error(`non-JSON ${init.method ?? 'GET'} ${route} (${response.status}): ${text.slice(0, 300)}`) }
  if (!response.ok || body?.ok === false) throw new Error(`${init.method ?? 'GET'} ${route} failed (${response.status}): ${body?.error ?? text}`)
  return body
}

const postStore = (base, route, body) => jsonRequest(base, route, { method: 'POST', body: JSON.stringify(body) })
const storePut = (base, table, row) => postStore(base, '/put', { table, row })
const storeRows = async (base, table, limit = 3000) => (await jsonRequest(base, `/rows?table=${encodeURIComponent(table)}&offset=0&limit=${limit}&includePayload=1`)).rows ?? []
const storeQuery = async (base, table, filter) => (await postStore(base, '/query', { table, filter, includePayload: true })).rows ?? []

function jsonWrite(file, value) { writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }
function fileSha256(file) { return createHash('sha256').update(readFileSync(file)).digest('hex') }

function launchApp() {
  mkdirSync(DATA, { recursive: true }); mkdirSync(LOCAL_APPDATA, { recursive: true }); mkdirSync(PROFILE, { recursive: true })
  const log = createWriteStream(APP_LOG, { flags: 'w' })
  const child = spawn(APP, [], {
    cwd: path.dirname(APP),
    env: { ...process.env, LOCALAPPDATA: LOCAL_APPDATA,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT} --user-data-dir="${PROFILE}" --no-first-run`,
      QINGHUA_RELEASE_GATE: '1', QINGHUA_RELEASE_GATE_DATA_DIR: DATA, QINGHUA_SHARED_STORE_PORT: String(STORE_PORT), QINGHUA_CANVAS_GATEWAY_PORT: GATEWAY_PORT, QINGHUA_CANVAS_GATEWAY_PORT: '28796' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(log); child.stderr.pipe(log)
  return { child, log }
}

function killOwnedApp(child) {
  if (!child || child.exitCode !== null) return
  spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
}

async function waitForStore() {
  return waitFor(async () => {
    const health = await jsonRequest(STORE, '/health')
    return path.resolve(String(health.dataDir ?? '')) === path.resolve(DATA) ? health : null
  }, 90_000, 'isolated shared store')
}

async function waitForCdp() {
  return waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
    return response.ok ? response.json() : null
  }, 60_000, 'Tauri WebView CDP')
}

async function connectPage() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
  const context = browser.contexts()[0] ?? (await browser.newContext())
  await waitFor(() => context.pages().some((candidate) => !candidate.url().startsWith('devtools://')), 20_000, 'Tauri page target')
  const page = context.pages().find((candidate) => !candidate.url().startsWith('devtools://')) ?? context.pages()[0]
  page.setDefaultTimeout(60_000)
  await page.waitForSelector('[data-app-sidebar]', { timeout: 60_000 })
  return { browser, context, page }
}

async function seedRealChannels() {
  const sourceRows = await storeRows(SOURCE_STORE, 'channels')
  const salt = await (await jsonRequest(SOURCE_STORE, '/kv/get', { method: 'POST', body: JSON.stringify({ key: 'qinghua.cred.salt' }) })).value
  if (!salt) throw new Error('source credential salt missing')
  await postStore(STORE, '/kv/put', { key: 'qinghua.cred.salt', value: salt })
  const targets = []
  for (const name of ['Chat2api', 'workbuddy']) {
    const source = sourceRows.find((row) => row.name === name)
    if (!source) throw new Error(`source channel ${name} missing`)
    const group = (source.credentialGroups ?? []).find((entry) => entry.hasToken)
    if (!group) throw new Error(`source channel ${name} has no credential`)
    const key = `qinghua.cred.${group.credentialRef}`
    const value = await (await jsonRequest(SOURCE_STORE, '/kv/get', { method: 'POST', body: JSON.stringify({ key }) })).value
    if (!value) throw new Error(`source credential ${key} missing`)
    await postStore(STORE, '/kv/put', { key, value })
    targets.push(source)
  }
  for (const source of targets) await storePut(STORE, 'channels', { ...source, enabled: true })
  // Workbuddy chat models must be selected; Chat2api needs one chat model selected
  // for the Agent session's chat route even when the turn generates an image.
  const chat2apiSource = targets.find((target) => target.name === 'Chat2api')
  if (chat2apiSource) {
    const chatSelection = (chat2apiSource.modelCache ?? []).filter((model) => model.category === 'chat').slice(0, 1)
    const primaryGroup = (chat2apiSource.credentialGroups ?? []).find((group) => group.hasToken)
    await storePut(STORE, 'channels', {
      ...chat2apiSource,
      enabled: true,
      models: [...(chat2apiSource.models ?? []), ...chatSelection.filter((model) => !(chat2apiSource.models ?? []).some((existing) => existing.id === model.id))],
      ...(primaryGroup
        ? {
            credentialGroups: (chat2apiSource.credentialGroups ?? []).map((group) =>
              group.id === primaryGroup.id
                ? { ...group, models: [...(group.models ?? []), ...chatSelection.filter((model) => !(group.models ?? []).some((existing) => existing.id === model.id))] }
                : group,
            ),
          }
        : {}),
    })
  }
  const rows = await storeRows(STORE, 'channels')
  for (const row of rows) {
    if (targets.some((target) => target.id === row.id)) continue
    if (!row.enabled) continue
    await storePut(STORE, 'channels', { ...row, enabled: false })
  }
  const verified = await storeRows(STORE, 'channels')
  jsonWrite(path.join(OUT, 'seed-debug.json'), verified.map((row) => ({
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    modelMap: row.modelMap,
    modelIds: (row.models ?? []).map((model) => model.id),
    modelCacheIds: (row.modelCache ?? []).map((model) => model.id),
    credentialGroups: (row.credentialGroups ?? []).map((group) => ({
      id: group.id,
      hasToken: group.hasToken,
      modelIds: (group.models ?? []).map((model) => model.id),
      modelCacheIds: (group.modelCache ?? []).map((model) => model.id),
    })),
  })))
  for (const target of targets) {
    const row = verified.find((entry) => entry.id === target.id)
    if (!row || row.enabled !== true || !(row.credentialGroups ?? []).some((entry) => entry.hasToken)) throw new Error(`real channel not ready: ${target.name}`)
  }
  return targets.map((target) => ({ id: String(target.id), name: String(target.name) }))
}

async function gotoProject(page, projectId) {
  const origin = new URL(page.url()).origin
  await page.goto(`${origin}/canvas/${projectId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-canvas-hydrated="true"]').waitFor({ state: 'attached', timeout: 30_000 })
  if ((await page.locator('[data-agent-panel]').count()) === 0) await page.locator('[data-canvas-agent]').click()
  await page.locator('[data-agent-panel]').waitFor({ state: 'visible', timeout: 20_000 })
}

function projectRow(id, name) {
  return { id, name, workbench: 'canvas', extra: {}, folderId: null, thumbnail: null, createdAt: NOW, updatedAt: NOW }
}

async function sendAndWaitJob(page, sessionId, prompt) {
  sendAudit.push({ at: Date.now(), sessionId, text: prompt, caller: 'harness' })
  const panel = page.locator('[data-agent-panel]')
  await panel.locator('[data-agent-input]').fill(prompt)
  await panel.locator('[data-agent-send]').click()
  await page.waitForTimeout(1200)
  const jobsNow = await storeQuery(STORE, 'agentJobs', { sessionId })
  if (!jobsNow[0]) {
    await panel.locator('[data-agent-input]').fill(prompt)
    await panel.locator('[data-agent-input]').press('Enter')
  }
  return waitFor(async () => {
    const jobs = await storeQuery(STORE, 'agentJobs', { sessionId })
    return jobs[0]?.id ?? null
  }, 30_000, 'AgentJob created')
}

async function waitJobTerminal(sessionId) {
  return waitFor(async () => {
    const jobs = await storeQuery(STORE, 'agentJobs', { sessionId })
    const job = jobs[0]
    if (!job) return null
    if (['completed', 'failed', 'canceled'].includes(job.status)) return job
    return null
  }, 300_000, 'AgentJob terminal')
}

/**
 * 发送审计（2026-11-04 加）：把「我们发起的发送」与「库里落下的 user 行」对账。
 * 目的：窗口是可交互的真实 WebView2，外部输入（人/仓库外自动化）可能往会话里塞消息；
 * 这种人塞一条会直接变成一次真实模型调用（要花钱），必须能被机器抓出来。
 */
const sendAudit = []

function auditSends(sessionId, messages) {
  const declared = sendAudit.filter((entry) => entry.sessionId === sessionId)
  const userMessages = messages.filter((message) => message.role === 'user')
  const unmatched = [...declared]
  const extraUserMessages = []
  for (const message of userMessages) {
    const text = String(message.content ?? '').trim()
    const index = unmatched.findIndex((entry) => entry.text.trim() === text)
    if (index >= 0) unmatched.splice(index, 1)
    else
      extraUserMessages.push({
        text: text.slice(0, 120),
        createdAt: message.createdAt ?? null,
        at: message.createdAt ? new Date(message.createdAt).toISOString() : null,
      })
  }
  const report = {
    declaredSends: declared.length,
    userRows: userMessages.length,
    missingSends: unmatched.map((entry) => ({ text: entry.text.slice(0, 120), at: new Date(entry.at).toISOString() })),
    extraUserMessages,
    ok: unmatched.length === 0 && extraUserMessages.length === 0,
  }
  if (!report.ok) {
    console.error('[send-audit] 账实不符：declared=' + report.declaredSends + ' userRows=' + report.userRows)
    for (const extra of report.extraUserMessages) console.error('[send-audit] 多出的 user 消息：' + JSON.stringify(extra))
    for (const missing of report.missingSends) console.error('[send-audit] 未落库的发送：' + JSON.stringify(missing))
  }
  return report
}

async function messagesFor(sessionId) {
  return (await storeQuery(STORE, 'agentMessages', { sessionId })).sort((left, right) => Number(left.sequence) - Number(right.sequence)).map((row) => row.message)
}

async function runRecordForProject(projectId) {
  return (await storeQuery(STORE, 'runRecords', { projectId }))[0] ?? null
}

function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

async function main() {
  rmSync(DATA, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 })
  rmSync(LOCAL_APPDATA, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 })
  rmSync(PROFILE, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 })
  mkdirSync(OUT, { recursive: true })
  const launched = launchApp()
  let browser = null; let page = null
  const pageErrors = []; const consoleErrors = []
  let result = null; let failure = null
  try {
    const health = await waitForStore()
    const cdp = await waitForCdp()
    const connected = await connectPage()
    browser = connected.browser; page = connected.page
    page.on('pageerror', (error) => pageErrors.push(String(error)))
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })

    const realChannels = await seedRealChannels()
    const chat2api = realChannels.find((row) => row.name === 'Chat2api')
    const workbuddy = realChannels.find((row) => row.name === 'workbuddy')
    if (!chat2api || !workbuddy) throw new Error('real channels missing after seed')

    const workProjectId = `proj_865_work_${NOW}`
    const workSessionId = `chat_865_work_${NOW}`
    const imageProjectId = `proj_865_image_${NOW}`
    const imageSessionId = `chat_865_image_${NOW}`
    await storePut(STORE, 'projects', projectRow(workProjectId, 'real-channels workbuddy 验收'))
    const workSession = { id: workSessionId, projectId: workProjectId, title: 'workbuddy 验收', channelId: workbuddy.id, model: 'cn:deepseek-v4.1-flash', imageModel: 'GPT Image 2', autoRun: false, queuedTurns: [], pendingSteers: [], messageRevision: 0, createdAt: NOW, updatedAt: NOW }
    await storePut(STORE, 'agentSessions', workSession)
    if (MODE === 'chat2api') {
      await storePut(STORE, 'projects', projectRow(imageProjectId, 'real-channels Chat2api 生图验收'))
      const imageSession = { id: imageSessionId, projectId: imageProjectId, title: 'Chat2api 生图验收', channelId: chat2api.id, model: 'auto', imageModel: 'GPT Image 2', autoRun: false, queuedTurns: [], pendingSteers: [], messageRevision: 0, createdAt: NOW, updatedAt: NOW }
      await storePut(STORE, 'agentSessions', imageSession)
    }

    const sourceBefore = await storeRows(SOURCE_STORE, 'channels')
    const sourceEnabledBefore = sourceBefore.filter((row) => row.enabled).map((row) => row.id).sort()

    const workResult = {}
    await gotoProject(page, workProjectId)
    const jobIdWork = await sendAndWaitJob(page, workSessionId, '请只回复四个字：验收通过。禁止调用工具、禁止创建节点、禁止生图。')
    await page.screenshot({ path: path.join(OUT, 'workbuddy-sent.png') })
    const jobWork = await waitFor(async () => {
      const messages = await messagesFor(workSessionId)
      const text = messages.filter((message) => message.role === 'assistant').map((message) => message.content ?? '').join('').trim()
      if (text.includes('验收通过')) return { status: 'replied', completed: true }
      return null
    }, 300_000, 'workbuddy text reply').catch(() => null)
    const workMessages = await messagesFor(workSessionId)
    const sendAuditResult = auditSends(workSessionId, workMessages)
    workResult.sendAudit = sendAuditResult
    const assistantText = workMessages.filter((message) => message.role === 'assistant').map((message) => message.content ?? '').join('\n').trim()
    workResult.jobId = jobIdWork; workResult.job = jobWork; workResult.assistantText = assistantText
    workResult.pass = Boolean(jobWork?.completed) && assistantText.includes('验收通过')
    await page.screenshot({ path: path.join(OUT, 'workbuddy-result.png') })
    const jobWorkFinal = await waitJobTerminal(workSessionId).catch(() => null)
    workResult.jobFinal = jobWorkFinal

    const imageResult = {}
    if (MODE === 'chat2api') {
    await gotoProject(page, imageProjectId)
    const jobIdImage = await sendAndWaitJob(page, imageSessionId, '生成一张 1024x1024 纯蓝色正方形测试图，不包含文字，只创建一个生图节点并请求确认。')
    await page.screenshot({ path: path.join(OUT, 'chat2api-sent.png') })
    const confirmVisible = await page
      .locator('[data-agent-confirm]')
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => true)
      .catch(() => false)
    if (confirmVisible) {
      await page.screenshot({ path: path.join(OUT, 'chat2api-confirm.png') })
      await page.locator('[data-agent-confirm]').click()
    }
    const jobImage = await waitJobTerminal(imageSessionId)
    const runRecordImage = await waitFor(async () => {
      const record = await runRecordForProject(imageProjectId)
      return record?.status === 'succeeded' ? record : null
    }, 300_000, 'image run record succeeded')
    imageResult.jobId = jobIdImage; imageResult.job = jobImage; imageResult.runRecord = runRecordImage
    const assetHash = runRecordImage?.outputHashes?.[0] ?? null
    imageResult.assetHash = assetHash
    imageResult.pass = jobImage?.status === 'completed' && runRecordImage?.status === 'succeeded' && Boolean(assetHash)
    if (assetHash) {
      const assetRows = await storeQuery(STORE, 'assets', { hash: assetHash })
      const assetRow = assetRows[0]
      imageResult.assetMime = assetRow?.mime ?? assetRow?.mimeType ?? null
      imageResult.assetBytes = assetRow?.bytes ?? assetRow?.size ?? null
      if (assetRow?.bytes) { try { const size = pngSize(Buffer.from(assetRow.bytes)); imageResult.pngSize = size } catch {} }
    }
    await page.screenshot({ path: path.join(OUT, 'chat2api-result.png') })
    } else {
      imageResult.skipped = 'mode=workbuddy'
    }

    const sourceAfter = await storeRows(SOURCE_STORE, 'channels')
    const sourceEnabledAfter = sourceAfter.filter((row) => row.enabled).map((row) => row.id).sort()

    result = {
      ok: MODE === 'workbuddy' ? workResult.pass && sendAuditResult.ok : workResult.pass && imageResult.pass && sendAuditResult.ok,
      windowInteractive: true,
      sendAudit: sendAuditResult,
      verdict:
        MODE === 'workbuddy'
          ? workResult.pass && sendAuditResult.ok
            ? 'workbuddy-pass'
            : 'workbuddy-blocked'
          : workResult.pass && imageResult.pass && sendAuditResult.ok
            ? 'real-channels-pass'
            : 'real-channels-blocked',
      mode: MODE,
      commit: COMMIT,
      app: { path: APP, bytes: readFileSync(APP).length, sha256: fileSha256(APP) },
      health, cdpBrowser: cdp.Browser,
      channels: realChannels,
      workbuddy: workResult,
      chat2api: imageResult,
      sourceEnabledBefore, sourceEnabledAfter,
      sourceUnchanged: JSON.stringify(sourceEnabledBefore) === JSON.stringify(sourceEnabledAfter),
      pageErrors, consoleErrors,
      timestamp: new Date().toISOString(),
    }
    writeSummary(result, { workMessages })
    jsonWrite(RESULT_PATH, result)
      } catch (error) {
    failure = { ok: false, verdict: 'failed', commit: COMMIT, error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error) }
    if (page) { try { await page.screenshot({ path: path.join(OUT, 'failure.png') }) } catch {} }
    jsonWrite(RESULT_PATH, failure)
    process.exitCode = 1
  } finally {
    if (browser) { try { await browser.close() } catch {} }
    killOwnedApp(launched.child)
    launched.log.end()
    if (true) {
      // keep debug data for diagnosis when acceptance fails
    } else {
      for (const dir of [DATA, LOCAL_APPDATA, PROFILE]) rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 })
    }
  }
}

main()


function auditLine(sendAudit) {
  return sendAudit.ok
    ? '账实相符断言**通过**（declared=' + sendAudit.declaredSends + '，userRows=' + sendAudit.userRows + '）'
    : '账实相符断言**未通过**：多出 ' + sendAudit.extraUserMessages.length + ' 条 user 消息（见 result.json sendAudit）'
}

function writeSummary(result, extra) {
  const lines = [
    '# real-channels 结果（' + result.mode + '）',
    '',
    '- commit：' + result.commit,
    '- 壳：' + result.app.path + '（' + result.app.bytes + ' B，sha256 ' + result.app.sha256.slice(0, 12) + '…）',
    '- 隔离库：' + result.health.dataDir,
    '- 结论：**' + (result.ok ? 'PASS' : 'FAIL/BLOCKED') + '**（' + result.verdict + '）',
    '',
    '> **窗口可交互**：本次应用窗口可交互，外部输入可能污染证据；' + auditLine(result.sendAudit) + '。',
    '',
    '## workbuddy',
    '- job：' + (result.workbuddy.job?.status ?? 'n/a') + '；assistantText：' + JSON.stringify(result.workbuddy.assistantText ?? ''),
    '- 发送审计：declared=' + result.sendAudit.declaredSends + '，userRows=' + result.sendAudit.userRows,
    '',
  ]
  if (result.mode === 'chat2api') {
    lines.push('## chat2api', '- job：' + (result.chat2api.job?.status ?? result.chat2api.skipped ?? 'n/a') + '；assetHash：' + (result.chat2api.assetHash ?? 'null'), '')
  }
  lines.push('## 页面', '- pageErrors=' + result.pageErrors.length + '，consoleErrors=' + result.consoleErrors.length, '')
  writeFileSync(path.join(OUT, 'SUMMARY.md'), lines.join('\n'), 'utf8')
}

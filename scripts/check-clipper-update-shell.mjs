#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const exeSource = path.join(root, 'src-tauri', 'target', 'release', 'qinghua.exe')
const resourceSource = path.join(
  root,
  'src-tauri',
  'target',
  'release',
  'resources',
)
const extensionSource = path.join(resourceSource, 'qinghua-clipper')
if (!existsSync(exeSource) || !existsSync(extensionSource)) {
  throw new Error('release build or bundled Clipper resource is missing')
}

const probeRoot = path.join(root, '.playwright-verify', 'clipper-update-shell')
const scratch = path.join(
  probeRoot,
  new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19),
)
const appDir = path.join(scratch, 'app')
const dataDir = path.join(appDir, 'data-v2')
const localAppData = path.join(scratch, 'localappdata')
const managedRoot = path.join(scratch, 'managed')
const stableExtension = path.join(managedRoot, 'extension')
const exePath = path.join(appDir, 'qinghua.exe')
const cdpPort = Number(process.env.QH_CLIPPER_CDP_PORT ?? 9455)
const storePort = Number(process.env.QH_CLIPPER_STORE_PORT ?? 18832)
const reportPath = path.join(probeRoot, 'report.json')
const logPath = path.join(scratch, 'run.log')

mkdirSync(path.join(appDir, 'resources'), { recursive: true })
mkdirSync(localAppData, { recursive: true })
mkdirSync(managedRoot, { recursive: true })
writeFileSync(logPath, '')
const trace = (message) => appendFileSync(logPath, `${message}\n`)
trace('preparing isolated release shell')
copyDirectory(extensionSource, path.join(appDir, 'resources', 'qinghua-clipper'))
copyFileSync(exeSource, exePath)
copyDirectory(extensionSource, stableExtension)
trace('copied release executable and resources')
const seededManifestPath = path.join(stableExtension, 'manifest.json')
const seededManifest = JSON.parse(readFileSync(seededManifestPath, 'utf8'))
seededManifest.version = '0.4.1'
writeFileSync(seededManifestPath, `${JSON.stringify(seededManifest, null, 2)}\n`)
trace(`seeded stable extension ${seededManifest.version}`)

const log = []
const app = spawn(exePath, [], {
  cwd: appDir,
  env: {
    ...process.env,
    LOCALAPPDATA: localAppData,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
    QINGHUA_RELEASE_GATE: '1',
    QINGHUA_RELEASE_GATE_DATA_DIR: dataDir,
    QINGHUA_SHARED_STORE_PORT: String(storePort),
    QINGHUA_DISABLE_UI_WATCHDOG: '1',
    QINGHUA_CLIPPER_MANAGED_ROOT: managedRoot,
    QINGHUA_CLIPPER_SKIP_OPEN: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
app.on('error', (error) => trace(`spawn error: ${String(error)}`))
app.stdout.on('data', (chunk) => {
  log.push(String(chunk))
  appendFileSync(logPath, chunk)
})
app.stderr.on('data', (chunk) => {
  log.push(String(chunk))
  appendFileSync(logPath, chunk)
})
trace(`spawned pid=${app.pid} exe=${exePath}`)
console.log(`release shell pid=${app.pid}`)

try {
  trace('waiting for CDP')
  const endpoint = await waitForCdp(cdpPort, app, 60_000)
  trace(`CDP ready at ${endpoint}`)
  const browser = await chromium.connectOverCDP(endpoint)
  const pages = browser.contexts().flatMap((context) => context.pages())
  const page = pages.find((candidate) => candidate.url().startsWith('http://tauri.localhost'))
    ?? pages[0]
  if (!page) throw new Error('release shell did not expose a page')
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(
    () => typeof globalThis.__TAURI_INTERNALS__?.invoke === 'function',
    { timeout: 30_000 },
  )
  await page.waitForTimeout(800)
  const invokeAvailable = await page.evaluate(
    () => typeof globalThis.__TAURI_INTERNALS__?.invoke === 'function',
  )
  if (!invokeAvailable) throw new Error('Tauri invoke bridge is unavailable')

  const before = await page.evaluate(
    () => globalThis.__TAURI_INTERNALS__.invoke('clipper_receiver_info'),
  )
  const update = await page.evaluate(
    () => globalThis.__TAURI_INTERNALS__.invoke('clipper_extension_update'),
  )
  const after = await page.evaluate(
    () => globalThis.__TAURI_INTERNALS__.invoke('clipper_receiver_info'),
  )
  const finalManifest = JSON.parse(readFileSync(seededManifestPath, 'utf8'))
  const stagingLeftovers = existsSync(managedRoot)
    ? readDirectory(managedRoot).filter((name) => name.startsWith('.extension-staging-'))
    : []
  const report = {
    ok:
      before.extension.stableVersion === '0.4.1'
      && before.extension.bundledVersion === '0.4.2'
      && before.extension.needsUpdate === true
      && update.updated === true
      && after.extension.stableVersion === '0.4.2'
      && after.extension.needsUpdate === false
      && after.extension.reloadRequired === true
      && finalManifest.version === '0.4.2'
      && stagingLeftovers.length === 0,
    before: before.extension,
    update,
    after: after.extension,
    finalManifestVersion: finalManifest.version,
    stagingLeftovers,
  }
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  await browser.close().catch(() => {})
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
} catch (error) {
  trace(`failed: ${String(error)}`)
  writeFileSync(path.join(scratch, 'failure.txt'), `${String(error)}\n`)
  console.error(error)
  process.exitCode = 1
} finally {
  killTree(app.pid)
  await new Promise((resolve) => setTimeout(resolve, 800))
  const appInsideProbe = appDir.startsWith(`${probeRoot}${path.sep}`)
  if (appInsideProbe && !process.exitCode) {
    rmSync(appDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 400 })
  }
}

async function waitForCdp(port, child, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`release shell exited early: ${child.exitCode}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return `http://127.0.0.1:${port}`
    } catch {
      // The WebView2 debug endpoint starts after the Tauri window.
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error('release shell CDP timeout')
}

function readDirectory(directory) {
  const result = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    result.push(entry.name)
  }
  return result
}

function copyDirectory(source, destination) {
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      copyDirectory(from, to)
    } else if (entry.isFile()) {
      copyFileSync(from, to)
    }
  }
}

function killTree(pid) {
  if (!pid) return
  spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
}

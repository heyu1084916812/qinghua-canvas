#!/usr/bin/env node
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const storePort = Number(process.env.QH_UI_STORE_PORT ?? 18772)
const cdpPort = Number(process.env.QH_UI_CDP_PORT ?? 9445)
const RESERVED_PORTS = new Set([1420, 18765, 18766, 18791])
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
const runRoot = path.join(ROOT, '.playwright-verify', `canvas-transform-ui-${timestamp}`, 'runtime')
const localAppData = path.join(runRoot, 'localappdata')
const dataDir = path.join(runRoot, 'product', 'data-v2')
const appLogPath = path.join(runRoot, 'app.log')

function portIsListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' })
    const finish = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(500)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // app is starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`timed out waiting for ${url}`)
}

async function main() {
  for (const port of [storePort, cdpPort]) {
    if (RESERVED_PORTS.has(port) || await portIsListening(port)) {
      throw new Error(`refusing unsafe or busy UI probe port: ${port}`)
    }
  }
  fs.mkdirSync(localAppData, { recursive: true })
  fs.mkdirSync(dataDir, { recursive: true })
  const appLog = fs.openSync(appLogPath, 'w')
  const releaseExe = path.join(ROOT, 'src-tauri', 'target', 'release', 'qinghua.exe')
  let app
  try {
    app = spawn(releaseExe, [], {
      cwd: path.dirname(releaseExe),
      env: {
        ...process.env,
        LOCALAPPDATA: localAppData,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [
          `--remote-debugging-port=${cdpPort}`,
          '--no-proxy-server',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
        ].join(' '),
        QINGHUA_RELEASE_GATE: '1',
        QINGHUA_RELEASE_GATE_DATA_DIR: dataDir,
        QINGHUA_SHARED_STORE_PORT: String(storePort),
      },
      stdio: ['ignore', appLog, appLog],
    })
    await waitForHttp(`http://127.0.0.1:${storePort}/health`)
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`)
    const probe = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify-canvas-transform-ui.mjs')], {
      env: { ...process.env, QH_UI_STORE_PORT: String(storePort), QH_UI_CDP_PORT: String(cdpPort) },
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
    if (probe.stdout) process.stdout.write(probe.stdout)
    if (probe.stderr) process.stderr.write(probe.stderr)
    if (probe.status !== 0) throw new Error(`UI probe exited with ${probe.status}`)
  } finally {
    if (app?.pid) spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
    fs.closeSync(appLog)
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) await main()

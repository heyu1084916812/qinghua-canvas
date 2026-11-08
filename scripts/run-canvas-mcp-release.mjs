#!/usr/bin/env node
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const reservedPorts = new Set([1420, 18765, 18766, 18768, 18791])
const storePort = Number(process.env.QH_MCP_RELEASE_STORE_PORT ?? 18774)
const cdpPort = Number(process.env.QH_MCP_RELEASE_CDP_PORT ?? 9448)
const gatewayPort = Number(process.env.QH_MCP_RELEASE_GATEWAY_PORT ?? 18775)
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
const runRoot = path.join(ROOT, '.playwright-verify', `canvas-mcp-release-${stamp}`)
const localAppData = path.join(runRoot, 'localappdata')
const dataDir = path.join(runRoot, 'product', 'data-v2')
const logPath = path.join(runRoot, 'app.log')

function listening(port) {
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

async function waitForHttp(url) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // wait for the real app / sidecar
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`timed out waiting for ${url}`)
}

for (const port of [storePort, cdpPort, gatewayPort]) {
  if (reservedPorts.has(port) || (await listening(port))) {
    throw new Error(`refusing unsafe or busy Canvas MCP port: ${port}`)
  }
}
const exe = path.join(ROOT, 'src-tauri', 'target', 'release', 'qinghua.exe')
if (!fs.existsSync(exe)) throw new Error('release executable missing')
fs.mkdirSync(localAppData, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
const log = fs.openSync(logPath, 'w')
let app
try {
  app = spawn(exe, [], {
    cwd: path.dirname(exe),
    env: {
      ...process.env,
      LOCALAPPDATA: localAppData,
      APPDATA: localAppData,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort} --no-proxy-server`,
      QINGHUA_RELEASE_GATE: '1',
      QINGHUA_RELEASE_GATE_DATA_DIR: dataDir,
      QINGHUA_SHARED_STORE_PORT: String(storePort),
      QINGHUA_CANVAS_GATEWAY_PORT: String(gatewayPort),
      QINGHUA_DISABLE_UI_WATCHDOG: '1',
    },
    stdio: ['ignore', log, log],
    windowsHide: true,
  })
  await waitForHttp(`http://127.0.0.1:${storePort}/health`)
  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`)
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'verify-canvas-mcp-release.mjs')],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        LOCALAPPDATA: localAppData,
        QH_MCP_RELEASE_RUNTIME_ROOT: runRoot,
        QH_MCP_RELEASE_STORE_PORT: String(storePort),
        QH_MCP_RELEASE_CDP_PORT: String(cdpPort),
        QH_MCP_RELEASE_GATEWAY_PORT: String(gatewayPort),
      },
      stdio: 'inherit',
    },
  )
  if (result.status !== 0) throw new Error(`real Canvas MCP probe exited ${result.status}`)
} finally {
  if (app?.pid) spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
  fs.closeSync(log)
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  console.log(`report: ${path.join(runRoot, 'report.json')}`)
}

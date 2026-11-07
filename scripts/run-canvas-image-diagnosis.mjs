#!/usr/bin/env node
// Diagnosis launcher for issue #971: starts an isolated Tauri release shell,
// runs diagnose-canvas-images.mjs as a child process, then kills only the
// app pid it spawned. Diagnosis only: no P95 pass/fail assertion and the
// report must never be treated as acceptance evidence.
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const RESERVED_PORTS = new Set([1420, 18765, 18766, 18791])

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
const runRoot = path.join(ROOT, '.playwright-verify', `canvas-image-diagnosis-${timestamp}`)
const dataDir = path.join(runRoot, 'product', 'data-v2')
const localAppData = path.join(runRoot, 'localappdata')
const reportPath = path.join(runRoot, 'report.json')
const appLogPath = path.join(runRoot, 'app.log')
const probeLogPath = path.join(runRoot, 'diagnosis.log')

const storePort = Number(process.env.QH_PERF_STORE_PORT ?? 18772)
const cdpPort = Number(process.env.QH_PERF_CDP_PORT ?? 9445)

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

async function assertProbePortsFree(ports) {
  for (const port of ports) {
    if (!Number.isInteger(port) || port <= 0 || RESERVED_PORTS.has(port)) {
      throw new Error(`refusing unsafe diagnosis port: ${port}`)
    }
    if (await portIsListening(port)) {
      throw new Error(`diagnosis port ${port} is already in use; not touching it`)
    }
  }
}

async function waitForHttp(url, timeoutMs, validate) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        const body = await response.text()
        if (!validate || validate(body)) return body
      }
    } catch {
      // app or shared-store still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`timed out waiting for ${url}`)
}

async function waitForPortRelease(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await portIsListening(port))) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`port ${port} still in use after killing the spawned app pid`)
}

async function main() {
  const dist = path.join(ROOT, 'dist', 'index.html')
  const releaseExe = process.env.QH_PERF_RELEASE_EXE
    ? path.resolve(process.env.QH_PERF_RELEASE_EXE)
    : path.join(ROOT, 'src-tauri', 'target', 'release', 'qinghua.exe')

  if (!fs.existsSync(dist)) {
    throw new Error('dist/index.html missing; run npm run build before diagnosis')
  }
  if (!fs.existsSync(releaseExe)) {
    throw new Error(`release executable missing: ${releaseExe}; run npm run tauri build first`)
  }
  if (fs.statSync(releaseExe).mtimeMs + 1000 < fs.statSync(dist).mtimeMs) {
    throw new Error(
      `release executable is older than dist (${releaseExe}); rebuild the desktop release before diagnosis`,
    )
  }
  await assertProbePortsFree([storePort, cdpPort])

  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(localAppData, { recursive: true })

  const appLog = fs.openSync(appLogPath, 'w')
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

    await waitForHttp(
      `http://127.0.0.1:${storePort}/health`,
      30_000,
      (body) => JSON.parse(body).service === 'qinghua-shared-store',
    )
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, 30_000)

    const probe = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'diagnose-canvas-images.mjs'), reportPath],
      {
        env: {
          ...process.env,
          QH_PERF_STORE_PORT: String(storePort),
          QH_PERF_CDP_PORT: String(cdpPort),
        },
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    )
    fs.writeFileSync(
      probeLogPath,
      `${probe.stdout ?? ''}\n${probe.stderr ?? ''}`,
    )
    if (probe.stdout) process.stdout.write(probe.stdout)
    if (probe.stderr) process.stderr.write(probe.stderr)
    if (probe.status !== 0) {
      throw new Error(
        `diagnose-canvas-images.mjs exited with ${probe.status}; see ${probeLogPath}`,
      )
    }
    console.log(`diagnosis only report (not acceptance evidence): ${path.relative(ROOT, reportPath)}`)
  } finally {
    if (app?.pid) {
      // Kill only the process tree this launcher spawned; never touch
      // processes bound to reserved user ports.
      spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], {
        stdio: 'ignore',
      })
      await waitForPortRelease(storePort).catch((error) => {
        console.error(`warning: ${error.message}`)
      })
      await waitForPortRelease(cdpPort).catch((error) => {
        console.error(`warning: ${error.message}`)
      })
    }
    fs.closeSync(appLog)
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  await main()
}

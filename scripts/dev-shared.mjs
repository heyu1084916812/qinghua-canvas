import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo'
const viteEntry = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')

/**
 * 桌面开发壳把自定义数据目录写在独立的开发配置中；浏览器开发库读同一份。
 * 正式版使用 storage-location.json，两者互不覆盖。
 */
function configuredDataDir() {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) return null
  const configPath = path.join(
    localAppData,
    'com.qinghua.canvas',
    'storage-location.dev.json',
  )
  if (!existsSync(configPath)) return null
  try {
    const value = JSON.parse(readFileSync(configPath, 'utf8'))?.dataDir
    return typeof value === 'string' && path.isAbsolute(value.trim()) ? value.trim() : null
  } catch {
    return null
  }
}

function backendForDataDir(dataDir) {
  const manifestPath = path.join(dataDir, 'manifest.json')
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const complete =
      manifest?.status === 'complete' &&
      existsSync(path.join(dataDir, 'manifest.sqlite')) &&
      existsSync(path.join(dataDir, 'media'))
    return complete ? 'v2' : 'v1'
  } catch {
    return 'v1'
  }
}

/** Desktop development follows the V2 root created by the legacy migration. */
const developmentDataDirs = [path.join(root, 'data-v2'), path.join(root, 'data')]

function defaultDevelopmentDataDir() {
  return (
    developmentDataDirs.find((dataDir) => backendForDataDir(dataDir) === 'v2') ??
    developmentDataDirs[1]
  )
}

async function healthy() {
  try {
    const response = await fetch('http://127.0.0.1:18765/health')
    if (!response.ok) return false
    const health = await response.json()
    return (
      health?.service === 'qinghua-shared-store' &&
      typeof health?.version === 'number' &&
      health.version >= 8
    )
  } catch {
    return false
  }
}

let storage = null
if (!(await healthy())) {
  const built = spawnSync(cargo, ['build', '--manifest-path', 'shared-store/Cargo.toml'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (built.status !== 0) process.exit(built.status || 1)
  const binary = path.join(
    root,
    'shared-store',
    'target',
    'debug',
    process.platform === 'win32' ? 'qinghua-store.exe' : 'qinghua-store',
  )
  const dataDir = configuredDataDir() ?? defaultDevelopmentDataDir()
  storage = spawn(binary, [], {
    cwd: root,
    stdio: 'inherit',
    env: dataDir
      ? {
          ...process.env,
          QINGHUA_DATA_DIR: dataDir,
          QINGHUA_STORE_BACKEND: backendForDataDir(dataDir),
        }
      : process.env,
  })
  const started = Date.now()
  while (!(await healthy())) {
    if (storage.exitCode !== null) {
      console.error('共享存储服务启动失败；Vite 不会启动，避免退回另一份 IndexedDB。')
      process.exit(storage.exitCode || 1)
    }
    if (Date.now() - started > 120_000) {
      console.error('共享存储服务启动超时。')
      storage.kill()
      process.exit(1)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

// Windows + Node 24 不能直接 spawn `npm.cmd`；绕过 npm 直接启动 Vite。
const vite = spawn(process.execPath, [viteEntry], {
  cwd: root,
  stdio: 'inherit',
})

const stop = () => {
  vite.kill()
  storage?.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
vite.on('exit', (code) => {
  storage?.kill()
  process.exit(code ?? 0)
})

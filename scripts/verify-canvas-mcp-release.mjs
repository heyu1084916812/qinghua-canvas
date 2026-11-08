#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const ROOT = path.resolve(import.meta.dirname, '..')
const runRoot = process.env.QH_MCP_RELEASE_RUNTIME_ROOT
const storePort = Number(process.env.QH_MCP_RELEASE_STORE_PORT)
const cdpPort = Number(process.env.QH_MCP_RELEASE_CDP_PORT)
const gatewayPort = Number(process.env.QH_MCP_RELEASE_GATEWAY_PORT)
if (!runRoot || !storePort || !cdpPort || !gatewayPort) throw new Error('release runtime is incomplete')

const output = path.join(runRoot, 'report.json')
const storeBase = `http://127.0.0.1:${storePort}`
const projectId = 'mcp-release-canvas'
const now = Date.now()
const project = {
  id: projectId,
  name: 'MCP release canvas',
  workbench: 'canvas',
  createdAt: now,
  updatedAt: now,
}
const nodes = [
  {
    id: 'mcp-prompt',
    projectId,
    type: 'prompt',
    title: 'Release prompt',
    x: 100,
    y: 100,
    w: 280,
    h: 180,
    data: { text: 'real release graph' },
  },
  {
    id: 'mcp-generation',
    projectId,
    type: 'generation',
    title: 'Release generation',
    x: 440,
    y: 100,
    w: 280,
    h: 280,
    data: { mode: 'image', prompt: 'real release graph' },
  },
]
const edges = [
  {
    id: 'mcp-edge',
    projectId,
    source: 'mcp-prompt',
    target: 'mcp-generation',
    sourcePort: 'output',
    targetPort: 'input',
  },
]

async function bulkPut(table, rows) {
  const response = await fetch(`${storeBase}/bulkPut`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ table, rows }),
  })
  if (!response.ok) throw new Error(`${table} seed failed: HTTP ${response.status}`)
}

async function waitFor(fn, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timed out waiting for real canvas MCP bridge')
}

function readGatewayConfig() {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        process.env.LOCALAPPDATA ?? '',
        'com.qinghua.canvas',
        'canvas-gateway.release-gate.json',
      ),
      'utf8',
    ),
  )
}

await bulkPut('projects', [project])
await bulkPut('nodes', nodes)
await bulkPut('edges', edges)
const config = await waitFor(() => {
  try {
    const candidate = readGatewayConfig()
    return candidate.url === `http://127.0.0.1:${gatewayPort}` ? candidate : null
  } catch {
    return null
  }
})
const gatewayHealth = await fetch(`${config.url}/health`).then((response) => response.json())
if (!gatewayHealth.ok) throw new Error('canvas gateway is unhealthy')

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
try {
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent('page'))
  await page.waitForURL(/tauri\.localhost/, { timeout: 30_000 })
  await page.evaluate(() => {
    localStorage.setItem('flow:onboarded', '1')
    localStorage.setItem('flow:canvasGuideDismissed', '1')
  })
  await page.goto(`http://tauri.localhost/canvas/${projectId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.locator('[data-canvas-hydrated="true"]').waitFor({ timeout: 30_000 })
  await page.waitForFunction(
    () => document.querySelectorAll('.react-flow__node').length === 2,
    null,
    { timeout: 20_000 },
  )

  const adapter = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(ROOT, 'src-tauri', 'resources', 'canvas-mcp.ps1'),
      '-ReleaseGate',
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        LOCALAPPDATA: path.join(runRoot, 'localappdata'),
        QINGHUA_CANVAS_URL: config.url,
        QINGHUA_CANVAS_TOKEN: config.token,
      },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  const stderr = []
  adapter.stderr.setEncoding('utf8')
  adapter.stderr.on('data', (chunk) => stderr.push(String(chunk)))
  const pending = new Map()
  const lines = readline.createInterface({ input: adapter.stdout, crlfDelay: Infinity })
  lines.on('line', (line) => {
    if (!line.trim()) return
    const message = JSON.parse(line)
    if (message.id !== undefined) {
      const entry = pending.get(message.id)
      if (entry) {
        pending.delete(message.id)
        entry.resolve(message)
      }
    }
  })
  let sequence = 0
  function request(method, params = {}) {
    const id = `mcp-release-${++sequence}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`MCP ${method} timed out`))
      }, 40_000)
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
      })
      adapter.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  try {
    const initialized = await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'isolated-mcp-harness', version: '1.0.0' },
    })
    if (initialized.result?.serverInfo?.name !== 'qinghua-canvas') {
      throw new Error('MCP initialize did not identify qinghua-canvas')
    }
    const listed = await request('tools/list')
    const toolNames = listed.result?.tools?.map((tool) => tool.name) ?? []
    for (const name of ['readGraph', 'readAsset', 'readResult']) {
      if (!toolNames.includes(name)) throw new Error(`MCP tool missing: ${name}`)
    }
    const read = await request('tools/call', {
      name: 'readGraph',
      arguments: { scope: 'all' },
    })
    const text = read.result?.content?.[0]?.text ?? ''
    const graph = JSON.parse(text)
    const result = graph.result
    if (
      graph.ok !== true ||
      read.result?.isError === true ||
      result?.nodes?.length !== 2 ||
      result?.edges?.length !== 1 ||
      result?.nodes?.[0]?.prompt !== 'real release graph' ||
      result?.edges?.[0]?.id !== 'mcp-edge'
    ) {
      throw new Error(`MCP readGraph did not return the seeded canvas: ${text}`)
    }

    const denied = []
    for (const tool of ['deleteNodes', 'runNode', 'rememberMemory']) {
      const response = await request('tools/call', { name: tool, arguments: {} })
      denied.push({ tool, isError: response.result?.isError === true })
      if (response.result?.isError !== true) throw new Error(`MCP allowed protected tool ${tool}`)
    }
    const rows = await fetch(`${storeBase}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ table: 'nodes', filter: { projectId } }),
    }).then((response) => response.json())
    if (rows.rows?.length !== 2) {
      throw new Error(`protected MCP requests changed the graph: ${JSON.stringify(rows.rows)}`)
    }

    fs.writeFileSync(
      output,
      `${JSON.stringify(
        {
          ok: true,
          harness: 'isolated-stdio-client',
          protocol: '2024-11-05',
          adapter: 'packaged-powershell',
          gateway: { port: gatewayPort, service: gatewayHealth.service },
          canvas: { projectId, nodes: result.nodes.length, edges: result.edges.length },
          tools: toolNames,
          protectedToolsDenied: denied,
          errors: [],
        },
        null,
        2,
      )}\n`,
    )
    console.log(JSON.stringify({ ok: true, projectId, tools: toolNames, denied }))
  } finally {
    lines.close()
    adapter.stdin.end()
    adapter.kill()
  }
  if (stderr.length) throw new Error(`MCP adapter stderr: ${stderr.join('')}`)
} finally {
  await browser.close()
}

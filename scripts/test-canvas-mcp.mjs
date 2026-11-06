#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { startCanvasMcpGateway } from './canvas-mcp-test-fixture.mjs'

if (process.platform !== 'win32') {
  console.log('canvas MCP stdio test skipped: Windows PowerShell is not available')
  process.exit(0)
}

const root = path.resolve(import.meta.dirname, '..')
const adapter =
  process.env.QH_CANVAS_MCP_ADAPTER ??
  path.join(root, 'src-tauri', 'resources', 'canvas-mcp.ps1')
function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`canvas MCP adapter exited with ${code}`))
    })
  })
}

const fixture = await startCanvasMcpGateway()
try {
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', adapter],
    {
      cwd: root,
      env: {
        ...process.env,
        QINGHUA_CANVAS_URL: fixture.url,
        QINGHUA_CANVAS_TOKEN: fixture.token,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  let stderr = ''
  let buffer = ''
  let nextId = 1
  const pending = new Map()

  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      const line = buffer.slice(0, newline).replace(/\r$/, '').trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      const message = JSON.parse(line)
      const waiter = pending.get(message.id)
      if (!waiter) continue
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    }
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`canvas MCP ${method} timed out`))
      }, 10_000)
      pending.set(id, {
        resolve(value) {
          clearTimeout(timer)
          resolve(value)
        },
        reject(error) {
          clearTimeout(timer)
          reject(error)
        },
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })

  const initialized = await send('initialize')
  if (initialized.serverInfo?.name !== 'qinghua-canvas') {
    throw new Error('canvas MCP initialize did not identify qinghua-canvas')
  }
  const listed = await send('tools/list')
  if (!Array.isArray(listed.tools) || listed.tools[0]?.name !== 'readGraph') {
    throw new Error('canvas MCP tools/list did not expose readGraph')
  }
  const called = await send('tools/call', {
    name: 'readGraph',
    arguments: { scope: 'all' },
    _meta: { idempotencyKey: 'canvas-mcp-test-call' },
  })
  const text = called.content?.[0]?.text ?? ''
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = null
  }
  if (called.isError === true || payload?.result?.nodes !== 2) {
    throw new Error(
      `canvas MCP tools/call did not return the gateway result: ${JSON.stringify(called)}`,
    )
  }
  if (fixture.actionCalls() !== 1) {
    throw new Error(`canvas MCP forwarded ${fixture.actionCalls()} actions instead of one`)
  }

  child.stdin.end()
  await waitForExit(child)
  if (stderr.trim()) throw new Error(`canvas MCP wrote stderr: ${stderr.trim()}`)
  console.log('canvas MCP stdio passed: initialize, tools/list, tools/call')
} finally {
  await fixture.close()
}

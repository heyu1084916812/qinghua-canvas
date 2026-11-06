#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'

if (process.platform !== 'win32') {
  console.log('canvas MCP stdio test skipped: Windows PowerShell is not available')
  process.exit(0)
}

const root = path.resolve(import.meta.dirname, '..')
const adapter = path.join(root, 'src-tauri', 'resources', 'canvas-mcp.ps1')
const token = 'canvas-mcp-test-token'
let actionCalls = 0

const server = createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401).end()
    return
  }
  if (request.method === 'GET' && request.url === '/capabilities') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        ok: true,
        result: {
          tools: [
            {
              name: 'readGraph',
              description: 'Read the current canvas graph',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
          denied: ['deleteNodes'],
        },
      }),
    )
    return
  }
  if (request.method === 'POST' && request.url === '/action') {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      const parsed = JSON.parse(body)
      actionCalls += 1
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          ok: true,
          result: {
            tool: parsed.name,
            idempotencyKey: parsed.idempotencyKey,
            nodes: 2,
          },
        }),
      )
    })
    return
  }
  response.writeHead(404).end()
})

function listen() {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`canvas MCP adapter exited with ${code}`))
    })
  })
}

try {
  const port = await listen()
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', adapter],
    {
      cwd: root,
      env: {
        ...process.env,
        QINGHUA_CANVAS_URL: `http://127.0.0.1:${port}`,
        QINGHUA_CANVAS_TOKEN: token,
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
  if (actionCalls !== 1) {
    throw new Error(`canvas MCP forwarded ${actionCalls} actions instead of one`)
  }

  child.stdin.end()
  await waitForExit(child)
  if (stderr.trim()) throw new Error(`canvas MCP wrote stderr: ${stderr.trim()}`)
  console.log('canvas MCP stdio passed: initialize, tools/list, tools/call')
} finally {
  server.close()
}

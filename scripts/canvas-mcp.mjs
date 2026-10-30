#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const useDevelopmentConfig = process.argv.includes('--dev')
const configPath = path.join(
  process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'),
  'com.qinghua.canvas',
  useDevelopmentConfig ? 'canvas-gateway.dev.json' : 'canvas-gateway.json',
)
const packageVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version

function gatewayConfig() {
  const envUrl = process.env.QINGHUA_CANVAS_URL?.trim()
  const envToken = process.env.QINGHUA_CANVAS_TOKEN?.trim()
  if (envUrl && envToken) return { url: envUrl, token: envToken }
  const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
  if (typeof parsed?.url !== 'string' || typeof parsed?.token !== 'string') {
    throw new Error(`Canvas 网关配置无效：${configPath}`)
  }
  return { url: parsed.url, token: parsed.token }
}

async function gatewayFetch(route, init = {}) {
  const config = gatewayConfig()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 35_000)
  try {
    const response = await fetch(`${config.url}${route}`, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(body?.error || `Canvas 网关返回 HTTP ${response.status}`)
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function result(id, value) {
  write({ jsonrpc: '2.0', id, result: value })
}

function error(id, code, message) {
  write({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return
  if (message.id === undefined) return
  try {
    if (message.method === 'initialize') {
      result(message.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'qinghua-canvas',
          version: packageVersion,
        },
      })
      return
    }
    if (message.method === 'ping') {
      result(message.id, {})
      return
    }
    if (message.method === 'tools/list') {
      const capabilities = await gatewayFetch('/capabilities')
      result(message.id, {
        tools: capabilities.result?.tools ?? capabilities.tools ?? [],
      })
      return
    }
    if (message.method === 'tools/call') {
      const name = String(message.params?.name ?? '').trim()
      if (!name) throw new Error('tools/call 缺少工具名')
      const response = await gatewayFetch('/action', {
        method: 'POST',
        body: JSON.stringify({
          name,
          arguments: message.params?.arguments ?? {},
          idempotencyKey: String(
            message.params?._meta?.idempotencyKey ??
              (message.id === undefined ? '' : `mcp:${message.id}`),
          ),
        }),
      })
      result(message.id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2),
          },
        ],
        isError: response?.ok === false,
      })
      return
    }
    error(message.id, -32601, `未知方法：${message.method}`)
  } catch (cause) {
    error(message.id, -32000, cause instanceof Error ? cause.message : String(cause))
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})
rl.on('line', (line) => {
  if (!line.trim()) return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    error(null, -32700, '不是有效 JSON')
    return
  }
  void handle(message)
})

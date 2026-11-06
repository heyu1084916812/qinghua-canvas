#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { startCanvasMcpGateway } from './canvas-mcp-test-fixture.mjs'

if (process.platform !== 'win32') {
  console.log('canvas MCP Inspector test skipped: Windows PowerShell is not available')
  process.exit(0)
}

const root = path.resolve(import.meta.dirname, '..')
const adapter = path.join(root, 'src-tauri', 'resources', 'canvas-mcp.ps1')
const outputDir = path.join(root, '.playwright-verify')
const outputFile = path.join(outputDir, 'canvas-mcp-inspector.json')
const fixture = await startCanvasMcpGateway()

function runInspector(args) {
  return new Promise((resolve, reject) => {
    const npmExecPath = process.env.npm_execpath
    const npxCli = npmExecPath
      ? path.join(path.dirname(npmExecPath), 'npx-cli.js')
      : null
    const useNodeNpx = npxCli && fs.existsSync(npxCli)
    const child = spawn(
      useNodeNpx ? process.execPath : process.platform === 'win32' ? 'npx.cmd' : 'npx',
      [
        ...(useNodeNpx ? [npxCli] : []),
        '-y',
        '@modelcontextprotocol/inspector',
        '--cli',
        ...args,
      ],
      {
        cwd: root,
        env: process.env,
        shell: process.platform === 'win32' && !useNodeNpx,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('MCP Inspector timed out after 120 seconds'))
    }, 120_000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`MCP Inspector exited with ${code}: ${stderr.trim()}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (error) {
        reject(
          new Error(
            `MCP Inspector returned non-JSON output: ${String(error)}\n${stdout.slice(0, 1000)}`,
          ),
        )
      }
    })
  })
}

const serverCommand = [
  'powershell.exe',
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  adapter,
]
const common = [
  '--quiet',
  '--format',
  'json',
  '--transport',
  'stdio',
  '--cwd',
  root,
  '-e',
  `QINGHUA_CANVAS_URL=${fixture.url}`,
  '-e',
  `QINGHUA_CANVAS_TOKEN=${fixture.token}`,
]

try {
  const listed = await runInspector([
    ...common,
    '--method',
    'tools/list',
    '--',
    ...serverCommand,
  ])
  const tools = Array.isArray(listed.tools) ? listed.tools : listed.result?.tools
  if (!Array.isArray(tools) || !tools.some((tool) => tool?.name === 'readGraph')) {
    throw new Error(`Inspector did not list readGraph: ${JSON.stringify(listed)}`)
  }

  const called = await runInspector([
    ...common,
    '--method',
    'tools/call',
    '--tool-name',
    'readGraph',
    '--tool-args-json',
    JSON.stringify({ scope: 'all' }),
    '--tool-metadata',
    'idempotencyKey=canvas-inspector-test-call',
    '--',
    ...serverCommand,
  ])
  const text = called.content?.[0]?.text ?? called.result?.content?.[0]?.text ?? ''
  const payload = JSON.parse(text)
  if (called.isError === true || payload?.result?.nodes !== 2) {
    throw new Error(`Inspector did not return the gateway result: ${JSON.stringify(called)}`)
  }
  if (fixture.actionCalls() !== 1) {
    throw new Error(`Inspector forwarded ${fixture.actionCalls()} actions instead of one`)
  }

  fs.mkdirSync(outputDir, { recursive: true })
  const report = {
    ok: true,
    harness: '@modelcontextprotocol/inspector --cli',
    initialize: 'implicit',
    listedTools: tools.map((tool) => tool.name),
    calledTool: 'readGraph',
    actionCalls: fixture.actionCalls(),
    result: payload,
  }
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2))
  console.log(
    'canvas MCP Inspector passed: tools/list, tools/call, real PowerShell stdio adapter',
  )
  console.log(`evidence: ${path.relative(root, outputFile)}`)
} finally {
  await fixture.close()
}

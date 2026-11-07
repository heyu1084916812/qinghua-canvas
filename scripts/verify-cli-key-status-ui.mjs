#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const ROOT = path.resolve(import.meta.dirname, '..')
const cdpPort = Number(process.env.QH_CLI_UI_CDP_PORT ?? 9445)
const runtimeRoot = process.env.QH_CLI_UI_RUNTIME_ROOT ?? ''
const output = path.join(ROOT, '.playwright-verify', 'cli-key-status-ui')
fs.mkdirSync(output, { recursive: true })

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x700', width: 1024, height: 700 },
]
const THEMES = ['light', 'dark']

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

async function setInputValue(page, selector, value) {
  await page.evaluate(
    ({ selector, value }) => {
      const input = document.querySelector(selector)
      if (!(input instanceof HTMLInputElement)) {
        throw new Error(`missing input: ${selector}`)
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    { selector, value },
  )
}

async function openCliPanel(page) {
  await page.locator('[data-sidebar-settings]').click()
  await page.locator('[data-global-settings]').waitFor({ timeout: 20_000 })
  await page.locator('[data-global-settings-tab="cli"]').click()
  await page.locator('[data-cli-tool="runninghub"]').waitFor({ timeout: 20_000 })
  await page.waitForTimeout(1_000)
  await page.locator('[data-cli-advanced="runninghub"] summary').click()
  await setInputValue(page, '[data-cli-status-args="runninghub"]', '')
  await page.locator('[data-cli-login-box="runninghub"] summary').click()
  await page.locator('[data-cli-key="runninghub"]').waitFor({ state: 'visible' })
  await page.locator('[data-cli-key="runninghub"]').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
}

function geometryOf(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return null
      const box = element.getBoundingClientRect()
      return {
        x: Number(box.x.toFixed(2)),
        y: Number(box.y.toFixed(2)),
        width: Number(box.width.toFixed(2)),
        height: Number(box.height.toFixed(2)),
      }
    }
    const panel = document.querySelector('[data-global-settings-panel]')
    return {
      viewport: { width: innerWidth, height: innerHeight },
      panel: rect('[data-global-settings-panel]'),
      keyInput: rect('[data-cli-key="runninghub"]'),
      keyButton: rect('[data-cli-key-login="runninghub"]'),
      message: rect('[data-cli-login-msg="runninghub"]'),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      panelOverflowX: panel ? panel.scrollWidth > panel.clientWidth : null,
      statusArgs: document.querySelector('[data-cli-status-args="runninghub"]')?.value ?? '',
      statusButton: document.querySelectorAll('[data-cli-status="runninghub"]').length,
      statusOutput: document.querySelectorAll('[data-cli-statusout="runninghub"]').length,
      loginMessage:
        document.querySelector('[data-cli-login-msg="runninghub"]')?.textContent?.trim() ?? '',
    }
  })
}

async function capture(page, prefix, viewport, theme) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  await page.evaluate((nextTheme) => localStorage.setItem('flow:theme', nextTheme), theme)
  await page.goto('http://tauri.localhost/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator('[data-sidebar-settings]').waitFor({ timeout: 30_000 })
  await openCliPanel(page)

  const before = await geometryOf(page)
  const beforeShot = path.join(output, `${prefix}-before-${viewport.name}-${theme}.png`)
  await page.locator('[data-global-settings-panel]').screenshot({ path: beforeShot })

  await page.locator('[data-cli-key="runninghub"]').fill('isolated-test-key')
  await page.locator('[data-cli-key-login="runninghub"]').click()
  await page.locator('[data-cli-login-msg="runninghub"]').waitFor({ timeout: 10_000 })
  const after = await geometryOf(page)
  const afterShot = path.join(output, `${prefix}-after-${viewport.name}-${theme}.png`)
  await page.locator('[data-global-settings-panel]').screenshot({ path: afterShot })
  return {
    before,
    after,
    screenshots: {
      before: path.relative(ROOT, beforeShot),
      after: path.relative(ROOT, afterShot),
    },
  }
}

function readCredentialWrite() {
  const credentialPath = path.join(runtimeRoot, 'localappdata', 'rh', 'config.toml')
  try {
    const text = fs.readFileSync(credentialPath, 'utf8')
    return {
      path: path.relative(ROOT, credentialPath),
      exists: true,
      containsSecret: text.includes('isolated-test-key'),
    }
  } catch {
    return {
      path: path.relative(ROOT, credentialPath),
      exists: false,
      containsSecret: false,
    }
  }
}

await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`)
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
try {
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent('page'))
  await page.waitForURL(/tauri\.localhost/, { timeout: 30_000 })
  await page.evaluate(() => {
    localStorage.setItem('flow:onboarded', '1')
    localStorage.setItem('flow:canvasGuideDismissed', '1')
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  const report = { ok: true, cases: {}, errors }
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      const key = `${viewport.name}-${theme}`
      report.cases[key] = await capture(page, 'cli', viewport, theme)
      const result = report.cases[key]
      result.credential = readCredentialWrite()
      const before = result.before
      const after = result.after
      report.ok =
        report.ok &&
        result.credential.exists &&
        result.credential.containsSecret &&
        after.statusArgs === '' &&
        after.statusButton === 0 &&
        after.statusOutput === 0 &&
        after.loginMessage.includes('没有配置状态命令，已跳过自动查询') &&
        before.keyInput?.x === after.keyInput?.x &&
        before.keyInput?.width === after.keyInput?.width &&
        before.keyInput?.height === after.keyInput?.height &&
        before.keyButton?.x === after.keyButton?.x &&
        before.keyButton?.width === after.keyButton?.width &&
        before.keyButton?.height === after.keyButton?.height &&
        after.keyInput?.y >= after.panel?.y &&
        after.keyInput?.y + after.keyInput?.height <= after.panel?.y + after.panel?.height &&
        after.message?.width > 0 &&
        after.message?.height > 0 &&
        !after.overflowX &&
        !after.panelOverflowX
    }
  }
  report.ok = report.ok && errors.length === 0
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
} finally {
  await browser.close().catch(() => undefined)
}

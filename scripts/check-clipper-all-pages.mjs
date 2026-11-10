#!/usr/bin/env node
/* global chrome */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const extensionPath = path.join(root, 'browser-extension', 'qinghua-clipper')
const output = path.join(root, '.playwright-verify', 'clipper-all-pages')
const profile = path.join(output, 'profile')
const browserRoot = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'ms-playwright')
  : ''
const bundledChromium = browserRoot && existsSync(browserRoot)
  ? readdirSync(browserRoot)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((left, right) => Number(right.split('-')[1]) - Number(left.split('-')[1]))
      .map((name) => path.join(browserRoot, name, 'chrome-win64', 'chrome.exe'))
      .find((candidate) => existsSync(candidate))
  : ''
const executablePath = process.env.QH_TEST_CHROMIUM || bundledChromium
if (!executablePath) throw new Error('Playwright Chromium executable not found')
mkdirSync(output, { recursive: true })
rmSync(profile, { recursive: true, force: true })
const context = await chromium.launchPersistentContext(profile, {
  executablePath,
  headless: true,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-proxy-server',
  ],
})

try {
  const worker = context.serviceWorkers()[0]
    ?? await context.waitForEvent('serviceworker', { timeout: 20_000 })
  const extensionId = new URL(worker.url()).host
  await context.route('https://first.example/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><title>Clipper probe</title><main>probe</main>',
  }))
  const firstPage = await context.newPage()
  await firstPage.goto('https://first.example/gallery', { waitUntil: 'domcontentloaded' })
  await new Promise((resolve) => setTimeout(resolve, 400))
  const beforeToggleInjected =
    await firstPage.locator('[data-qinghua-drop-target]').count() > 0

  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.locator('#drag-mode').click()
  await popup.waitForFunction(
    () => document.querySelector('#drag-mode')?.checked === true,
  )
  await worker.evaluate(async () => {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const { dragMode } = await chrome.storage.local.get({ dragMode: false })
      const scripts = await chrome.scripting.getRegisteredContentScripts({
        ids: ['qinghua-drag-collector'],
      })
      if (dragMode && scripts.length === 1) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('global drag switch did not register the content script')
  })
  await popup.close()
  await firstPage.locator('[data-qinghua-drop-target]').waitFor({
    state: 'attached',
    timeout: 10_000,
  })
  await new Promise((resolve) => setTimeout(resolve, 800))
  const permissions = await worker.evaluate(async () => ({
    http: await chrome.permissions.contains({ origins: ['http://*/*'] }),
    https: await chrome.permissions.contains({ origins: ['https://*/*'] }),
    manifest: chrome.runtime.getManifest().version,
    dragMode: (await chrome.storage.local.get({ dragMode: false })).dragMode,
  }))

  const pages = [{
    name: 'first',
    host: 'first.example',
    beforeToggleInjected,
    injected: await firstPage.locator('[data-qinghua-drop-target]').count() === 1,
  }]
  await firstPage.close()
  for (const [name, host] of [['second', 'second.example']]) {
    await context.route(`https://${host}/**`, (route) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><title>Clipper probe</title><main>probe</main>',
    }))
    const page = await context.newPage()
    await page.goto(`https://${host}/gallery`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-qinghua-drop-target]').waitFor({
      state: 'attached',
      timeout: 10_000,
    })
    pages.push({
      name,
      host,
      beforeToggleInjected: false,
      injected: await page.locator('[data-qinghua-drop-target]').count() === 1,
    })
    await page.close()
  }

  const report = {
    ok:
      permissions.http
      && permissions.https
      && permissions.manifest === '0.4.6'
      && permissions.dragMode === true
      && pages[0]?.beforeToggleInjected === false
      && pages.every((page) => page.injected),
    extensionId,
    permissions,
    pages,
    boundary: 'chrome://、edge://、扩展商店等浏览器保护页不允许注入',
  }
  writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
} finally {
  await context.close()
}

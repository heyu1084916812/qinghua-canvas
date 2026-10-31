import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:1420'
const OUT = '.playwright-verify'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = []
const viewports = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1024', width: 1024, height: 700 },
]

for (const viewport of viewports) {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: theme,
    })
    const page = await context.newPage()
    page.setDefaultTimeout(120_000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })

    await page.goto(`${BASE}/inspiration`, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    })
    await page.waitForTimeout(1000)
    const onboarding = page.getByRole('button', { name: '知道了，开始用' })
    if (await onboarding.isVisible().catch(() => false)) {
      await onboarding.click()
    }
    await page.waitForSelector('[data-inspiration-research-open]', { timeout: 30_000 })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-inspiration-card]').length > 0,
      undefined,
      { timeout: 30_000 },
    )

    if (theme === 'dark') {
      const current = await page.locator('html').getAttribute('data-theme')
      if (current !== 'dark') {
        await page.click('[data-theme-toggle]')
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
      }
    }

    await page.click('[data-inspiration-research-open]')
    await page.fill('[data-design-research-topic]', 'minimal')
    await page.fill('[data-design-research-urls]', '')
    await page.click('[data-design-research-run]')
    await page.waitForSelector('[data-design-research-results]', { timeout: 30_000 })
    await page.waitForTimeout(250)

    const geometry = await page.evaluate(() => {
      const panel = document.querySelector('[data-design-research-panel] section')
      const grid = document.querySelector('[data-design-research-results]')
      const save = document.querySelector('[data-design-research-save]')
      const rect = (node) => {
        const box = node?.getBoundingClientRect()
        return box
          ? { x: box.x, y: box.y, width: box.width, height: box.height }
          : null
      }
      return {
        theme: document.documentElement.dataset.theme,
        panel: rect(panel),
        grid: rect(grid),
        save: rect(save),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        resultCount: document.querySelectorAll('[data-design-research-item]').length,
        groupCount: document.querySelectorAll('[data-design-research-results] section').length,
      }
    })

    const shot = `${OUT}/design-research-${viewport.name}-${theme}.png`
    await page.screenshot({ path: shot, fullPage: false })
    await page.getByRole('button', { name: '关闭' }).click()
    await page.click('[data-inspiration-research-open]')
    await page.waitForSelector('[data-design-research-results]', { timeout: 30_000 })
    const restoredResultCount = await page.locator('[data-design-research-item]').count()
    results.push({
      viewport,
      theme,
      shot,
      geometry,
      restoredResultCount,
      errors,
      pass:
        errors.length === 0 &&
        geometry.overflowX === 0 &&
        geometry.resultCount > 0 &&
        geometry.groupCount > 0 &&
        restoredResultCount === geometry.resultCount &&
        Boolean(geometry.panel) &&
        geometry.panel.x >= 0 &&
        geometry.panel.y >= 0 &&
        geometry.panel.x + geometry.panel.width <= viewport.width &&
        geometry.panel.y + geometry.panel.height <= viewport.height,
    })
    await context.close()
  }
}

await browser.close()
writeFileSync(
  `${OUT}/design-research-layout.json`,
  JSON.stringify(results, null, 2),
)
console.log(JSON.stringify(results, null, 2))
if (results.some((result) => !result.pass)) process.exitCode = 1

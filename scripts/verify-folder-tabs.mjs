/** Read-only UI evidence for #1149. --check makes geometry regressions fail. */
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { measureTab } from './folderTabChecks.mjs'

const out = process.argv[2] ?? 'review/2026-11-19-folder-tabs/after'
const check = process.argv.includes('--check')
const browser = await chromium.launch({ channel: 'chrome' })
const results = []
await mkdir(out, { recursive: true })


try {
  for (const [width, height] of [[1440, 900], [1024, 700]]) {
    for (const theme of ['dark', 'light']) {
      const tag = `${width}x${height}-${theme}`
      const context = await browser.newContext({ viewport: { width, height } })
      await context.addInitScript((theme) => {
        localStorage.setItem('flow:theme', theme)
        localStorage.setItem('flow:onboarded', '1')
        localStorage.setItem('flow:canvasGuideDismissed', '1')
      }, theme)
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(String(error)))
      await page.goto('http://127.0.0.1:1420/projects', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-sidebar-settings]').click()
      await page.locator('[data-global-settings-tab="channels"]').click()
      await page.locator('[data-channel-item]').nth(Number(process.env.PROBE_CHANNEL_INDEX ?? 6)).click()
      await page.locator('[data-key-group-tab]').first().waitFor()
      const rows = []
      for (const [name, selector] of [['keys', '[data-key-group-tab]'], ['mapping', '[data-route-map-filter]']]) {
        const tabs = page.locator(selector)
        for (let i = 0; i < await tabs.count(); i++) {
          const tab = tabs.nth(i)
          await tab.click()
          await page.waitForTimeout(1100)
          rows.push({ name, i, mode: 'mouse', ...await measureTab(tab) })
          await page.screenshot({ path: `${out}/${tag}-${name}-${i}.png` })
        }
        if (name === 'mapping') {
          await tabs.first().click()
          await tabs.first().press('End')
          await page.waitForTimeout(1100)
          rows.push({ name, mode: 'keyboard-end', ...await measureTab(tabs.last()) })
          await page.screenshot({ path: `${out}/${tag}-focus-end.png` })
          await tabs.last().press('Home')
          await page.waitForTimeout(1100)
          rows.push({ name, mode: 'keyboard-home', ...await measureTab(tabs.first()) })
          await page.screenshot({ path: `${out}/${tag}-focus-home.png` })
        }
      }
      results.push({ tag, rows, errors })
      console.log(tag, JSON.stringify(rows.map(({ name, mode, label, left, right, clipped }) => ({ name, mode, label, left, right, clipped }))))
      await context.close()
    }
  }
} finally {
  await browser.close()
  await writeFile(`${out}/geometry.json`, JSON.stringify(results, null, 2))
}
if (check && results.some(({ rows, errors }) => errors.length || rows.some((r) => !Number.isFinite(r.difference) || r.difference > 1.5 || r.clipped || (r.mode.startsWith('keyboard') && (!r.focusVisible || !r.focusPainted))))) {
  throw new Error('Folder tabs alignment/visibility failed; see geometry.json')
}

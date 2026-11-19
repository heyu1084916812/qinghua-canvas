import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// Read-only check on a configured local channel. Capture the same category before/after.
const out = process.argv[2]
const results = []
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
try {
  for (const [width, height] of [[1440,900], [1024,700]]) for (const theme of ['light','dark']) {
    const tag = `${width}x${height}-${theme}`
    const page = await browser.newPage({ viewport: { width, height } })
    await page.addInitScript(t => {
      localStorage.setItem('flow:theme', t)
      localStorage.setItem('flow:onboarded', '1')
    }, theme)
    await page.goto('http://127.0.0.1:1420/projects', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-sidebar-settings]').click()
    await page.locator('[data-global-settings-tab="channels"]').click()
    await page.locator('[data-channel-item]').nth(Number(process.env.PROBE_CHANNEL_INDEX ?? 6)).click()
    await page.locator('[data-route-map-filter="image"]').click()
    const table = page.locator('[data-route-map-table]')
    const rows = page.locator('[data-route-map-rows]')
    const panel = page.locator('[data-settings-channel-route]')
    await table.scrollIntoViewIfNeeded()
    await page.waitForTimeout(700)
    await panel.screenshot({path:`${out}/${tag}.png`})
    const stats = await rows.evaluate(host => {
      const entries = [...host.querySelectorAll('[data-route-map-row]')]
      const rect = (el, selector) => el.querySelector(selector).getBoundingClientRect()
      const gaps = entries.slice(1).map((row, i) => rect(row,'[data-route-map-frontend]').top - rect(entries[i],'[data-route-map-uncommon]').bottom)
      const overhang = entries.map(row => rect(row,'[data-route-map-uncommon]').bottom - row.getBoundingClientRect().bottom)
      host.scrollTop = host.scrollHeight
      return { count:entries.length, minGap:Math.min(...gaps), overhang:Math.max(...overhang), height:host.clientHeight, scroll:host.scrollTop,
        lastVisible:rect(entries.at(-1),'[data-route-map-uncommon]').bottom <= host.getBoundingClientRect().bottom + 1 }
    })
    const audio = page.locator('[data-route-map-filter="audio"]')
    await audio.scrollIntoViewIfNeeded()
    const top = await audio.evaluate(el => el.getBoundingClientRect().top)
    await audio.click()
    await page.waitForTimeout(400)
    const shift = await audio.evaluate((el,y) => el.getBoundingClientRect().top-y,top)
    const shortHeight = await rows.evaluate(el => el.clientHeight)
    results.push({tag, ...stats, shift, shortHeight})
    await page.close()
  }
} finally { await browser.close() }
await writeFile(`${out}/geometry.json`, JSON.stringify(results,null,2)+'\n')
console.table(results)
if (process.argv.includes('--check')) for (const r of results) {
  assert(r.count >= 3 && r.minGap >= 0 && r.overhang <= 1 && r.lastVisible, r.tag)
  assert(r.shortHeight < r.height && Math.abs(r.shift) <= 1, r.tag)
  if (r.tag.startsWith('1024')) assert(r.scroll > 0, r.tag)
}

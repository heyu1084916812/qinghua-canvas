#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer as createViteServer } from 'vite'

const ROOT = path.resolve(import.meta.dirname, '..')
const phase = process.argv.includes('--after') ? 'after' : 'before'
const stage = process.argv.includes('--after') ? 'after' : 'before'
const evidenceDetail = '按当前任务匹配到 3 张参考。\n- 【品牌标准字】保持字形与颜色不变。'
const beforeHistory = [
  { id: 'intent', text: '先核对参考图，再规划输出。', source: 'intent', createdAt: 1 },
  {
    id: 'phase-ref',
    text: '参考分析完成：已筛选 3 张用于本轮',
    phase: 'referenceAnalysis',
    collapsedSummary: '参考分析完成 · 3 项依据',
    createdAt: 2,
  },
]
const out = path.join(ROOT, '.playwright-verify', `agent-phase-${phase}`)
fs.mkdirSync(out, { recursive: true })

const variants = [
  { width: 1440, height: 900, theme: 'dark' },
  { width: 1440, height: 900, theme: 'light' },
  { width: 1024, height: 700, theme: 'dark' },
  { width: 1024, height: 700, theme: 'light' },
]
const vite = await createViteServer({
  root: ROOT,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
})
const { AgentActivityStrip } = await vite.ssrLoadModule(
  '/src/workbenches/canvas/panels/AgentPanel/AgentActivityViews.tsx',
)
const history = [
  { id: 'intent', text: '先核对参考图，再规划输出。', source: 'intent', createdAt: 1 },
  {
    id: 'phase-ref',
    text: evidenceDetail,
    phase: 'referenceAnalysis',
    collapsedSummary: '参考分析完成 · 3 项依据',
    createdAt: 2,
  },
]
const stripProps = (entries = stage === 'before' ? beforeHistory : history) => ({
  status: { kind: 'idle' },
  items: [],
  activities: [],
  history: entries,
  processText: '',
  startedAt: 1,
  finishedAt: 3,
  live: false,
})
const renderStrip = (entries = history) =>
  renderToStaticMarkup(createElement(AgentActivityStrip, stripProps(entries)))
const html = renderStrip(stage === 'before' ? beforeHistory : history)
const expandedHtml = html
  .replace('data-agent-activity-expanded="false"', 'data-agent-activity-expanded="true"')
  .replace(
    /<div class="[^"]*activityHead[^"]*"[^>]*>[\s\S]*?<\/div>(?=<div data-agent-activity-list)/,
    '<div class="activityHead"><span>参考分析完成 · 3 项依据</span></div>',
  )
  .replace(
    '</section>',
    `<div data-agent-activity-list><div data-agent-process-row="intent">先核对参考图，再规划输出。</div><div data-agent-process-row="phase-ref">${evidenceDetail}</div></div></section>`,
  )
const plainHtml = renderStrip([
  { id: 'intent', text: '先核对参考图，再规划输出。', source: 'intent', createdAt: 1 },
  { id: 'reasoning', text: '准备按当前参考规划输出。', source: 'reasoning', createdAt: 2 },
])

const beforeExpandedHtml = html
  .replace('data-agent-activity-expanded="false"', 'data-agent-activity-expanded="true"')
  .replace(
    '</section>',
    `<div data-agent-activity-list>${[
      { id: 'intent', text: '先核对参考图，再规划输出。' },
      { id: 'phase-ref', text: '参考分析完成：已筛选 3 张用于本轮' },
    ].map((row) => `<div data-agent-process-row="${row.id}">${row.text}</div>`).join('')}</div></section>`,
  )

const pageHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root { color-scheme: light; --bg-canvas:#f7f7f7; --bg-surface:#fff; --bg-hover:#f1f1f1; --text-1:#151515; --text-2:#4b4b4b; --text-3:#777; --stroke:#ddd; --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:20px; --fs-chip:12px; --fs-label:13px; --fw-title:600; }
:root[data-theme="dark"] { color-scheme: dark; --bg-canvas:#181818; --bg-surface:#242424; --bg-hover:#303030; --text-1:#f2f2f2; --text-2:#bcbcbc; --text-3:#888; --stroke:#3b3b3b; }
body { margin:0; background:var(--bg-canvas); color:var(--text-1); font-family:system-ui,"Microsoft YaHei",sans-serif; }
.frame { width:min(420px,calc(100vw - 48px)); margin:40px auto; padding:16px; background:var(--bg-surface); border:1px solid var(--stroke); }
</style></head><body><div class="frame" data-agent-phase-frame>${html}</div><div class="frame" data-agent-phase-plain-frame>${plainHtml}</div></body></html>`

const browser = await chromium.launch({ channel: 'chrome', args: ['--no-proxy-server'] })
const report = []
try {
  for (const variant of variants) {
    const context = await browser.newContext({
      viewport: { width: variant.width, height: variant.height },
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    await page.setContent(pageHtml, { waitUntil: 'domcontentloaded' })
    await page.evaluate((expandedHtml) => {
      const frame = document.querySelector('[data-agent-phase-frame]')
      if (frame) frame.dataset.expandedSource = expandedHtml
    }, stage === 'before' ? beforeExpandedHtml : expandedHtml)
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme
    }, variant.theme)
    const file = `${variant.width}-${variant.theme}`
    const collapsed = await page.evaluate(() => {
      const frame = document.querySelector('[data-agent-phase-frame]')
      const activity = frame?.querySelector('[data-agent-activity]')
      const box = activity?.getBoundingClientRect()
      const text = activity?.querySelector('[data-agent-process-current] span[aria-hidden="true"]')?.textContent ?? ''
      const toggle = activity?.querySelector('[data-agent-activity-toggle]')
      return {
        expanded: activity?.getAttribute('data-agent-activity-expanded'),
        text,
        width: box?.width ?? 0,
        height: box?.height ?? 0,
        toggleFocusable: toggle?.getAttribute('tabindex') !== '-1',
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }
    })
    const plain = await page.evaluate(() => {
      const activity = document.querySelector('[data-agent-phase-plain-frame] [data-agent-activity]')
      return {
        text: activity?.querySelector('[data-agent-process-current] span[aria-hidden="true"]')?.textContent ?? '',
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }
    })
    await page.screenshot({ path: path.join(out, `${file}-collapsed.png`) })
    await page.evaluate(() => {
      const frame = document.querySelector('[data-agent-phase-frame]')
      if (!frame) return
      frame.innerHTML = frame.dataset.expandedSource ?? ''
    })
    const expanded = await page.evaluate(() => {
      const activity = document.querySelector('[data-agent-activity]')
      const rows = [...(activity?.querySelectorAll('[data-agent-process-row]') ?? [])]
      const rect = activity?.getBoundingClientRect()
      const toggle = activity?.querySelector('[data-agent-activity-toggle]')
      toggle?.focus()
      toggle?.setAttribute('aria-expanded', 'true')
      return {
        expanded: activity?.getAttribute('data-agent-activity-expanded'),
        rows: rows.length,
        rowText: rows.map((row) => row.textContent?.trim() ?? ''),
        focusedToggle: document.activeElement === toggle,
        toggleAriaExpanded: toggle?.getAttribute('aria-expanded'),
        childrenOutsideX: [...(activity?.querySelectorAll('*') ?? [])].filter((child) => {
          const box = child.getBoundingClientRect()
          return box.width > 0 && rect && (box.left < rect.left - 1 || box.right > rect.right + 1)
        }).length,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }
    })
    await page.screenshot({ path: path.join(out, `${file}-expanded.png`) })
    report.push({ variant, collapsed, expanded, plain })
    await context.close()
  }
} finally {
  await browser.close()
  await vite.close()
}
fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(`${phase} agent phase evidence: ${path.join(out, 'report.json')}`)

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:1420'
const OUT = '.playwright-verify'
const LONG_PROMPT = Array.from(
  { length: 18 },
  (_, index) => `第 ${index + 1} 段：生成一张具有清晰品牌层级、材质细节与留白节奏的视觉稿。`,
).join('\n')
const SHORT_PROMPT = '生成一张简洁的品牌主视觉。'
const viewports = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1024', width: 1024, height: 700 },
]

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = []

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

    await page.goto(`${BASE}/projects`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    const onboarding = page.getByRole('button', { name: /知道了|开始用/ })
    if (await onboarding.isVisible().catch(() => false)) {
      await onboarding.click()
    }
    await page.locator('[data-new-card]').click()
    await page.locator('[data-new-workbench="canvas"]').click()
    await page.waitForURL(/\/canvas\//)
    await page.locator('[data-canvas-toolbar]').waitFor({ state: 'visible' })
    await page.locator('[data-toolbar-add]').click()
    await page.locator('[data-toolbar-menu-item="generation"]').click()
    await page.waitForFunction(
      () => document.querySelectorAll('[data-node-type="generation"]').length > 0,
      undefined,
      { timeout: 30_000 },
    )
    await page.waitForTimeout(1000)

    if (theme === 'dark') {
      const current = await page.locator('html').getAttribute('data-theme')
      if (current !== 'dark') {
        await page.click('[data-theme-toggle]')
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
      }
    }

    const node = page.locator('[data-node-type="generation"]').first()
    await node.waitFor({ state: 'visible' })
    await node.click({ position: { x: 30, y: 30 } })
    const panel = page.locator('[data-creation-panel]')
    await panel.waitFor({ state: 'visible' })
    await page.waitForTimeout(1200)
    const editor = panel.locator('[data-panel-prompt]')
    await editor.waitFor({ state: 'visible' })

    const readState = () =>
      page.evaluate(() => {
        const panel = document.querySelector('[data-creation-panel]')
        const box = panel?.querySelector('[data-panel-prompt-box]')
        const editor = panel?.querySelector('[data-panel-prompt]')
        const bar = panel?.querySelector('[data-panel-prompt-expand-bar]')
        const button = panel?.querySelector('[data-panel-prompt-expand]')
        const path = button?.querySelector('path')
        const rect = (node) => {
          const box = node?.getBoundingClientRect()
          return box
            ? {
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
                right: box.right,
                bottom: box.bottom,
              }
            : null
        }
        const panelBox = rect(panel)
        const editorStyle = editor ? getComputedStyle(editor) : null
        const scale =
          editor && editor.offsetWidth > 0
            ? editor.getBoundingClientRect().width / editor.offsetWidth
            : 1
        const borderRight = editorStyle
          ? Number.parseFloat(editorStyle.borderRightWidth) || 0
          : 0
        const scrollbarWidth =
          editor && editorStyle
            ? Math.max(0, editor.offsetWidth - editor.clientWidth)
            : 0
        const scrollbarSizeCss = editorStyle
          ? Number.parseFloat(
              editorStyle.getPropertyValue('--prompt-scrollbar-size'),
            ) || 6
          : 6
        const editorRect = rect(editor)
        const buttonRect = rect(button)
        return {
          theme: document.documentElement.dataset.theme,
          expanded: panel?.getAttribute('data-panel-expanded'),
          panel: panelBox,
          box: rect(box),
          editor: editorRect,
          bar: rect(bar),
          button: buttonRect,
          buttonLabel: button?.getAttribute('aria-label') ?? '',
          iconPath: path?.getAttribute('d') ?? '',
          editorClientHeight: editor?.clientHeight ?? 0,
          editorScrollHeight: editor?.scrollHeight ?? 0,
          editorScrollTop: editor?.scrollTop ?? 0,
          scrollbarWidth,
          scrollbarSizeCss,
          scrollbarCenter:
            editorRect !== null
              ? editorRect.right -
                borderRight * scale -
                (scrollbarSizeCss * scale) / 2
              : null,
          buttonCenter:
            buttonRect !== null ? buttonRect.x + buttonRect.width / 2 : null,
          paddingLeft: editor ? getComputedStyle(editor).paddingLeft : '',
          paddingRight: editor ? getComputedStyle(editor).paddingRight : '',
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          viewport: { width: innerWidth, height: innerHeight },
        }
      })

    await editor.fill(SHORT_PROMPT)
    await page.waitForTimeout(250)
    const short = await readState()
    const shortShot = `${OUT}/prompt-expander-${viewport.name}-${theme}-short.png`
    await page.screenshot({ path: shortShot })

    await editor.fill(LONG_PROMPT)
    await panel.locator('[data-panel-prompt-expand]').waitFor({
      state: 'visible',
      timeout: 10_000,
    })
    await editor.evaluate((node) => {
      node.scrollTop = Math.min(96, node.scrollHeight - node.clientHeight)
      node.dispatchEvent(new Event('scroll'))
      node.dataset.scrollActive = 'true'
    })
    await page.waitForTimeout(80)
    const collapsedLong = await readState()
    const longShot = `${OUT}/prompt-expander-${viewport.name}-${theme}-long.png`
    await page.screenshot({ path: longShot })

    await panel.locator('[data-panel-prompt-expand]').click()
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-creation-panel]')
          ?.getAttribute('data-panel-expanded') === 'true',
    )
    await page.waitForTimeout(150)
    const expanded = await readState()
    const expandedShot = `${OUT}/prompt-expander-${viewport.name}-${theme}-expanded.png`
    await page.screenshot({ path: expandedShot })

    await panel.locator('[data-panel-prompt-expand]').click()
    await editor.fill(SHORT_PROMPT)
    await page.waitForTimeout(300)
    const collapsedShort = await readState()

    const contained = (state) =>
      Boolean(state.panel) &&
      state.panel.x >= 0 &&
      state.panel.y >= 0 &&
      state.panel.right <= state.viewport.width &&
      state.panel.bottom <= state.viewport.height
    const buttonSharesScrollbarRail =
      Boolean(collapsedLong.button && collapsedLong.editor) &&
      Math.abs(collapsedLong.button.y - collapsedLong.editor.y) <= 1 &&
      collapsedLong.button.x >= collapsedLong.editor.right - 20 &&
      collapsedLong.button.right <= collapsedLong.editor.right + 4
    const opticalSidePadding =
      Math.abs(
        Number.parseFloat(collapsedLong.paddingLeft) -
          (Number.parseFloat(collapsedLong.paddingRight) +
            collapsedLong.scrollbarSizeCss),
      ) <= 1
    const buttonCenteredOnScrollbar =
      collapsedLong.buttonCenter !== null &&
      collapsedLong.scrollbarCenter !== null &&
      Math.abs(collapsedLong.buttonCenter - collapsedLong.scrollbarCenter) <= 1

    results.push({
      viewport,
      theme,
      shortShot,
      longShot,
      expandedShot,
      errors,
      short,
      collapsedLong,
      expanded,
      collapsedShort,
      checks: {
        shortHidesExpander:
          !short.button && !short.bar && short.editorScrollHeight <= short.editorClientHeight + 1,
        longOverflows:
          collapsedLong.editorScrollHeight > collapsedLong.editorClientHeight + 1,
        longShowsButton: Boolean(collapsedLong.button && !collapsedLong.bar),
        noTopBand: !collapsedLong.bar && !expanded.bar,
        textStartsAtSameTop:
          Math.abs(collapsedLong.editor.y - short.editor.y) <= 1 &&
          Math.abs(expanded.editor.y - short.editor.y) <= 1,
        buttonSharesScrollbarRail,
        buttonCenteredOnScrollbar,
        opticalSidePadding,
        collapsedArrowUp: collapsedLong.iconPath === 'm6 14.5 6-6 6 6',
        expandedArrowDown: expanded.iconPath === 'm6 9.5 6 6 6-6',
        expandedLabel: expanded.buttonLabel === '收起编辑区',
        collapsedAgain: collapsedShort.expanded === 'false',
        collapseHidesExpander: !collapsedShort.button && !collapsedShort.bar,
        contained: contained(short) && contained(collapsedLong) && contained(expanded),
        noHorizontalOverflow:
          short.overflowX === 0 &&
          collapsedLong.overflowX === 0 &&
          expanded.overflowX === 0,
        noPageErrors: errors.length === 0,
      },
    })

    await context.close()
  }
}

await browser.close()
for (const result of results) {
  result.pass = Object.values(result.checks).every(Boolean)
}
writeFileSync(
  `${OUT}/prompt-expander-layout.json`,
  JSON.stringify(results, null, 2),
)
console.log(JSON.stringify(results, null, 2))
if (results.some((result) => !result.pass)) process.exitCode = 1

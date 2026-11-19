// Intersect the actual rendered path at the content's midline. Bounding boxes
// include the flared feet and cannot measure the whitespace beside the text.
export async function measureTab(tab) {
  return tab.evaluate((element) => {
    const host = element.closest('[role="tablist"]')
    const inner = element.querySelector('[class*="keyGroupTabInner"]')
    const path = host.querySelector('svg[class*="keyGroupMorph"] path')
    const r = inner.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    const viewport = host.getBoundingClientRect()
    const matrix = path.getScreenCTM()
    const length = path.getTotalLength()
    const at = (distance) => path.getPointAtLength(distance).matrixTransform(matrix)
    const y = (r.top + r.bottom) / 2
    const intersections = []
    for (let i = 0; i < 600; i++) {
      let a = length * i / 600
      let b = length * (i + 1) / 600
      const start = at(a).y - y
      if (start * (at(b).y - y) >= 0) continue
      for (let j = 0; j < 20; j++) {
        const mid = (a + b) / 2
        if ((at(mid).y - y) * start > 0) a = mid
        else b = mid
      }
      intersections.push(at((a + b) / 2).x)
    }
    const left = Math.min(...intersections)
    const right = Math.max(...intersections)
    const round = (n) => Math.round(n * 100) / 100
    const focusStyle = getComputedStyle(inner)
    const focusOutset = parseFloat(focusStyle.outlineWidth) + parseFloat(focusStyle.outlineOffset)
    return {
      label: element.innerText.replace(/\s+/g, ' '),
      selected: element.getAttribute('aria-selected') === 'true',
      left: round(r.left - left), right: round(right - r.right),
      difference: round(Math.abs((r.left - left) - (right - r.right))),
      clipped: box.left < viewport.left - 1 || box.right > viewport.right + 1,
      focused: document.activeElement === element,
      focusVisible: element.matches(':focus-visible'),
      focusPainted: focusStyle.outlineStyle === 'solid' && parseFloat(focusStyle.outlineWidth) >= 2 &&
        r.left - focusOutset >= viewport.left && r.right + focusOutset <= viewport.right,
      scrollLeft: host.scrollLeft,
      tabTop: round(box.top),
      box: [round(box.left), round(box.right)],
      viewport: [round(viewport.left), round(viewport.right)],
    }
  })
}

/** Called by G83 only after its isolated-store setup; never mutates user data. */
export async function checkFolderTabs(page, rec, group, out) {
  const oldViewport = page.viewportSize()
  const oldTheme = await page.evaluate(() => document.documentElement.dataset.theme)
  // /settings lacks the global-settings sidebar; use the actual overlay where
  // the last category was clipped at the desktop minimum width.
  const channelId = await page.locator('[data-settings-provider-head] [data-channel-enabled]').getAttribute('data-channel-enabled')
  await page.goto(new URL('/projects', page.url()).href, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-sidebar-settings]').click()
  await page.locator('[data-global-settings-tab="channels"]').click()
  await page.locator(`[data-channel-item][data-channel-id="${channelId}"]`).click()
  const keyTabs = page.locator('[data-key-group-tab]')
  for (let i = await keyTabs.count(); i < 3; i++) {
    await page.locator('[data-key-group-add]').click()
    await page.waitForFunction((count) => document.querySelectorAll('[data-key-group-tab]').length === count, i + 1)
  }
  const longId = await keyTabs.last().getAttribute('data-key-group-tab')
  const longTab = page.locator(`[data-key-group-tab="${longId}"]`)
  await longTab.click()
  await page.waitForTimeout(500)
  await longTab.locator('[data-key-group-name-text]').dblclick()
  await page.locator('[data-key-group-name]').fill('这是一个用于验证省略号和优先级留白的超长分组标题')
  await page.locator('[data-key-group-name]').press('Enter')
  await longTab.getByTitle('修改分组优先级').click()
  await page.locator('[data-key-group-priority]').fill('100')
  // Priority commits on blur and reorders groups; wait before choosing by index.
  await page.locator('[data-key-group-priority]').press('Tab')
  await page.locator('[data-key-group-priority]').waitFor({ state: 'hidden' })
  await longTab.getByTitle('修改分组优先级').filter({ hasText: 'P100' }).waitFor()
  const results = []
  for (const [width, height] of [[1440, 900], [1024, 700]]) {
    await page.setViewportSize({ width, height })
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
      const tag = `${width}-${theme}`
      const rows = []
      for (const selector of ['[data-key-group-tab]', '[data-route-map-filter]']) {
        const tabs = page.locator(selector)
        for (let i = 0; i < await tabs.count(); i++) {
          await tabs.nth(i).click()
          await page.waitForTimeout(1000)
          rows.push(await measureTab(tabs.nth(i)))
        }
      }
      rec(group, `#1149 ${tag} 首/中/末与长标题的左右真实留白相等`, rows.every((r) => r.selected && r.difference <= 1.5 && r.left >= 10 && r.right >= 10 && !r.clipped), JSON.stringify(rows))
      const tabs = page.locator('[data-route-map-filter]')
      await tabs.first().click()
      await page.waitForTimeout(1000)
      const initialY = await tabs.first().evaluate((el) => el.getBoundingClientRect().top)
      const focus = []
      for (const key of ['End', 'Home', 'ArrowLeft', 'ArrowRight']) {
        await page.locator('[data-route-map-filter][aria-selected="true"]').press(key)
        await page.waitForTimeout(1000)
        focus.push(await measureTab(page.locator('[data-route-map-filter][aria-selected="true"]')))
        if (key === 'End') await page.screenshot({ path: `${out}/g83-folder-${tag}-end.png` })
      }
      rec(group, `#1149 ${tag} 键盘首尾循环完整可见、焦点可见且不纵跳`, focus.every((r) => r.focused && r.focusVisible && r.focusPainted && !r.clipped && Math.abs(r.tabTop - initialY) <= 1), JSON.stringify(focus))
      await longTab.click()
      await longTab.click({ button: 'right' })
      const menuVisible = await page.getByRole('menuitem', { name: /编辑/ }).isVisible()
      await page.keyboard.press('Escape')
      await longTab.locator('[data-key-group-name-text]').dblclick()
      await page.screenshot({ path: `${out}/g83-folder-${tag}-rename.png` })
      const renameVisible = await page.locator('[data-key-group-name]').isVisible()
      await page.locator('[data-key-group-name]').press('Escape')
      rec(group, `#1149 ${tag} 长标题改名和右键菜单仍可用`, menuVisible && renameVisible)
      results.push({ tag, rows, focus })
    }
  }
  await page.setViewportSize(oldViewport)
  await page.evaluate((value) => { document.documentElement.dataset.theme = value }, oldTheme)
  return results
}

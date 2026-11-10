/* global chrome, clearTimeout, importScripts, QinghuaClipper, setTimeout */
importScripts('shared.js')

const MENU_ID = 'qinghua-clip-current-page'
const BADGE_CLEAR_MS = 4_000
let badgeTimer = null

chrome.runtime.onInstalled.addListener(() => {
  void installContextMenu()
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return
  void clipActivePage(tab).catch(() => undefined)
})

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'clip-active-page') return
  void clipActivePage().catch(() => undefined)
})

async function installContextMenu() {
  await chrome.contextMenus.removeAll()
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '收藏当前页到轻画',
    contexts: ['page', 'link'],
  })
}

async function clipActivePage(tab) {
  try {
    const current = tab ?? (await activeTab())
    const pageUrl = QinghuaClipper.normalizePageUrl(current?.url)
    if (!pageUrl) {
      throw new Error('当前页面不是可收藏的网页')
    }
    const config = await chrome.storage.local.get({
      endpoint: QinghuaClipper.DEFAULT_ENDPOINT,
      token: '',
    })
    if (!config.token) {
      throw new Error('轻画未配对，点击扩展图标填写令牌')
    }
    await QinghuaClipper.clipPage({
      endpoint: config.endpoint,
      token: config.token,
      url: pageUrl,
      title: current.title || '',
    })
    await chrome.storage.local.set({
      lastClipAt: Date.now(),
      lastClipTitle: current.title || pageUrl,
      lastClipUrl: pageUrl,
      lastClipStatus: 'sent',
    })
    await showBadge('✓', '#2f6b4f', '已发送到轻画')
  } catch (error) {
    await chrome.storage.local.set({
      lastClipAt: Date.now(),
      lastClipStatus: 'error',
      lastClipError: QinghuaClipper.errorText(error),
    })
    await showBadge('!', '#9b3c32', QinghuaClipper.errorText(error))
    throw error
  }
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  return tabs[0] ?? null
}

async function showBadge(text, color, title) {
  if (badgeTimer) clearTimeout(badgeTimer)
  await chrome.action.setBadgeBackgroundColor({ color })
  await chrome.action.setBadgeText({ text })
  await chrome.action.setTitle({ title })
  badgeTimer = setTimeout(() => {
    void chrome.action.setBadgeText({ text: '' })
    void chrome.action.setTitle({ title: '收藏到轻画' })
  }, BADGE_CLEAR_MS)
}

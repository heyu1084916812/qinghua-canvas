/* global chrome, clearTimeout, importScripts, QinghuaClipper, setTimeout */
importScripts('shared.js')

const PAGE_MENU_ID = 'qinghua-clip-current-page'
const IMAGE_MENU_ID = 'qinghua-clip-image'
const BADGE_CLEAR_MS = 4_000
let badgeTimer = null

chrome.runtime.onInstalled.addListener(() => {
  void installContextMenu()
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === PAGE_MENU_ID) {
    void clipActivePage(tab).catch(() => undefined)
  }
  if (info.menuItemId === IMAGE_MENU_ID) {
    void clipImageFromTab({
      tab,
      pageUrl: tab?.url,
      imageUrl: info.srcUrl,
      title: tab?.title,
    }).catch(() => undefined)
  }
})

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'clip-active-page') return
  void clipActivePage().catch(() => undefined)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'qinghua:start-drag') {
    const tabId = sender.tab?.id
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: false, error: '当前标签页无法开启投放区' })
      return false
    }
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['drop-target.js'],
    }).then(() => sendResponse({ ok: true })).catch((error) => {
      sendResponse({ ok: false, error: QinghuaClipper.errorText(error) })
    })
    return true
  }

  if (message?.type === 'qinghua:clip-image') {
    clipImageFromTab({
      tab: sender.tab,
      pageUrl: message.pageUrl,
      imageUrl: message.imageUrl,
      title: message.title,
    }).then(() => sendResponse({ ok: true })).catch((error) => {
      sendResponse({ ok: false, error: QinghuaClipper.errorText(error) })
    })
    return true
  }
  return false
})

async function installContextMenu() {
  await chrome.contextMenus.removeAll()
  chrome.contextMenus.create({
    id: PAGE_MENU_ID,
    title: '收藏当前页到轻画',
    contexts: ['page', 'link'],
  })
  chrome.contextMenus.create({
    id: IMAGE_MENU_ID,
    title: '收藏这张图片到轻画',
    contexts: ['image'],
  })
}

async function clipActivePage(tab) {
  const current = tab ?? (await activeTab())
  const pageUrl = QinghuaClipper.normalizePageUrl(current?.url)
  if (!pageUrl) throw new Error('当前页面不是可收藏的网页')
  await sendClip({
    pageUrl,
    title: current?.title || '',
  })
}

async function clipImageFromTab(input) {
  const pageUrl = QinghuaClipper.normalizePageUrl(input.pageUrl)
  const imageUrl = QinghuaClipper.normalizePageUrl(input.imageUrl)
  if (!pageUrl || !imageUrl) {
    throw new Error('没有识别到可收藏的图片地址')
  }
  await sendClip({
    pageUrl,
    title: input.title || '',
    imageUrl,
  })
}

async function sendClip(input) {
  try {
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
      url: input.pageUrl,
      title: input.title || '',
      imageUrl: input.imageUrl || '',
    })
    const saved = {
      lastClipAt: Date.now(),
      lastClipTitle: input.title || input.pageUrl,
      lastClipUrl: input.pageUrl,
      lastClipStatus: 'sent',
      lastClipError: '',
      lastClipImageUrl: input.imageUrl || '',
    }
    await chrome.storage.local.set(saved)
    await showBadge('✓', '#2f6b4f', input.imageUrl ? '图片已发送到轻画' : '已发送到轻画')
    return saved
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

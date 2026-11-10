/* global chrome, clearTimeout, importScripts, QinghuaClipper, setTimeout */
importScripts('shared.js')

const DRAG_SCRIPT_ID = 'qinghua-drag-collector'
const DRAG_MATCHES = ['http://*/*', 'https://*/*']
const BADGE_CLEAR_MS = 2_500
let badgeTimer = null

void ensureDragRegistration()

chrome.runtime.onInstalled.addListener(() => {
  void ensureDragRegistration()
})

chrome.runtime.onStartup.addListener(() => {
  void ensureDragRegistration()
})

chrome.permissions.onRemoved.addListener((permissions) => {
  if (!permissions.origins?.length) return
  void setDragMode(false)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'qinghua:connect') {
    connectReceiver()
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: QinghuaClipper.errorText(error),
      }))
    return true
  }

  if (message?.type === 'qinghua:set-drag-mode') {
    setDragMode(Boolean(message.enabled))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({
        ok: false,
        error: QinghuaClipper.errorText(error),
      }))
    return true
  }

  if (message?.type === 'qinghua:clip-image') {
    clipImageFromTab(sender.tab, message)
      .then((saved) => sendResponse({ ok: true, saved }))
      .catch((error) => sendResponse({
        ok: false,
        error: QinghuaClipper.errorText(error),
      }))
    return true
  }

  return false
})

async function ensureDragRegistration() {
  const { dragMode } = await chrome.storage.local.get({ dragMode: false })
  if (!dragMode) {
    await unregisterDragScript()
    return { ok: true, enabled: false }
  }
  const granted = await chrome.permissions.contains({ origins: DRAG_MATCHES })
  if (!granted) {
    await chrome.storage.local.set({ dragMode: false })
    return { ok: false, enabled: false }
  }
  await registerDragScript()
  await injectIntoOpenTabs()
  return { ok: true, enabled: true }
}

async function setDragMode(enabled) {
  await chrome.storage.local.set({ dragMode: enabled })
  if (!enabled) {
    await unregisterDragScript()
    await notifyOpenTabs({ type: 'qinghua:disable-drag' })
    return
  }
  const granted = await chrome.permissions.contains({ origins: DRAG_MATCHES })
  if (!granted) {
    throw new Error('需要允许轻画访问网页，才能开启拖拽收藏')
  }
  await registerDragScript()
  await injectIntoOpenTabs()
}

async function registerDragScript() {
  await unregisterDragScript()
  await chrome.scripting.registerContentScripts([{
    id: DRAG_SCRIPT_ID,
    matches: DRAG_MATCHES,
    js: ['drop-target.js'],
    runAt: 'document_idle',
    allFrames: false,
    persistAcrossSessions: true,
  }])
}

async function unregisterDragScript() {
  const scripts = await chrome.scripting.getRegisteredContentScripts({
    ids: [DRAG_SCRIPT_ID],
  }).catch(() => [])
  if (scripts.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [DRAG_SCRIPT_ID] })
  }
}

async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: DRAG_MATCHES }).catch(() => [])
  for (const tab of tabs) {
    if (!Number.isInteger(tab.id)) continue
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['drop-target.js'],
    }).catch(() => undefined)
  }
}

async function notifyOpenTabs(message) {
  const tabs = await chrome.tabs.query({ url: DRAG_MATCHES }).catch(() => [])
  for (const tab of tabs) {
    if (!Number.isInteger(tab.id)) continue
    await chrome.tabs.sendMessage(tab.id, message).catch(() => undefined)
  }
}

async function connectReceiver() {
  const endpoint = QinghuaClipper.DEFAULT_ENDPOINT
  await QinghuaClipper.checkReceiver(endpoint)
  const token = await QinghuaClipper.pairReceiver(endpoint)
  await chrome.storage.local.set({ endpoint, token })
  return { ok: true, endpoint, paired: true }
}

async function clipImageFromTab(tab, message) {
  const pageUrl = QinghuaClipper.normalizePageUrl(message.pageUrl)
    || QinghuaClipper.normalizePageUrl(tab?.url)
  const imageUrl = QinghuaClipper.normalizePageUrl(message.imageUrl)
  if (!pageUrl || !imageUrl) {
    throw new Error('没有识别到可收藏的图片地址')
  }
  return sendClip({
    pageUrl,
    imageUrl,
    title: String(message.title || tab?.title || '').trim(),
  })
}

async function sendClip(input) {
  try {
    const config = await chrome.storage.local.get({
      endpoint: QinghuaClipper.DEFAULT_ENDPOINT,
      token: '',
    })
    const endpoint = QinghuaClipper.normalizeEndpoint(config.endpoint)
    if (!endpoint) throw new Error('本机接收端地址无效')

    let token = String(config.token || '').trim()
    if (!token) token = await pairAndStore(endpoint)
    try {
      await QinghuaClipper.clipPage({
        endpoint,
        token,
        url: input.pageUrl,
        title: input.title,
        imageUrl: input.imageUrl,
      })
    } catch (error) {
      if (error?.code !== 'auth' && error?.code !== 'not-paired') throw error
      token = await pairAndStore(endpoint)
      await QinghuaClipper.clipPage({
        endpoint,
        token,
        url: input.pageUrl,
        title: input.title,
        imageUrl: input.imageUrl,
      })
    }

    const saved = {
      lastClipAt: Date.now(),
      lastClipTitle: input.title || input.imageUrl,
      lastClipStatus: 'sent',
      lastClipError: '',
    }
    await chrome.storage.local.set(saved)
    await showBadge('✓', '#171814', '图片已收藏到轻画')
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

async function pairAndStore(endpoint) {
  const token = await QinghuaClipper.pairReceiver(endpoint)
  await chrome.storage.local.set({ token })
  return token
}

async function showBadge(text, color, title) {
  if (badgeTimer) clearTimeout(badgeTimer)
  await chrome.action.setBadgeBackgroundColor({ color })
  await chrome.action.setBadgeText({ text })
  await chrome.action.setTitle({ title })
  badgeTimer = setTimeout(() => {
    void chrome.action.setBadgeText({ text: '' })
    void chrome.action.setTitle({ title: '轻画拖拽收藏' })
  }, BADGE_CLEAR_MS)
}

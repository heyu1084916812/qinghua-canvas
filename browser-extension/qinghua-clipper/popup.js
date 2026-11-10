/* global chrome, document, navigator, QinghuaClipper, URL, window */
const api = QinghuaClipper

const elements = {
  status: document.querySelector('#status'),
  dot: document.querySelector('#status-dot'),
  retry: document.querySelector('#retry'),
  pageCard: document.querySelector('#page-card'),
  pageKind: document.querySelector('#page-kind'),
  pageHost: document.querySelector('#page-host'),
  title: document.querySelector('#page-title'),
  url: document.querySelector('#page-url'),
  clip: document.querySelector('#clip'),
  clipLabel: document.querySelector('#clip-label'),
  drag: document.querySelector('#drag'),
  dragLabel: document.querySelector('#drag-label'),
  lastResult: document.querySelector('#last-result'),
  version: document.querySelector('#version'),
  settings: document.querySelector('#settings'),
  endpoint: document.querySelector('#endpoint'),
  token: document.querySelector('#token'),
  toggleToken: document.querySelector('#toggle-token'),
  save: document.querySelector('#save'),
  clear: document.querySelector('#clear'),
}

const state = {
  tab: null,
  pageValid: false,
  tokenConfigured: false,
  checking: false,
  clipping: false,
  injecting: false,
  online: false,
}

elements.retry.addEventListener('click', () => void checkConnection())
elements.toggleToken.addEventListener('click', toggleTokenVisibility)
elements.save.addEventListener('click', () => void saveSettings())
elements.clear.addEventListener('click', () => void clearSettings())
elements.clip.addEventListener('click', () => void clipCurrentPage())
elements.drag.addEventListener('click', () => void startDragCollection())

if (/Mac|iPhone|iPad/i.test(navigator.platform)) {
  elements.clip.querySelector('kbd').textContent = 'Command+Shift+Y'
}

void initialize()

async function initialize() {
  const version = chrome.runtime?.getManifest?.().version
  if (version) elements.version.textContent = `v${version}`
  const config = await chrome.storage.local.get({
    endpoint: api.DEFAULT_ENDPOINT,
    token: '',
    lastClipAt: 0,
    lastClipTitle: '',
    lastClipStatus: '',
    lastClipError: '',
  })
  elements.endpoint.value = config.endpoint
  elements.token.value = config.token
  state.tokenConfigured = Boolean(config.token)
  await loadCurrentTab()
  showLastClip(config)

  if (!state.tokenConfigured) {
    elements.settings.open = true
    setStatus('先完成接收端配对', 'idle')
    updateClipButton()
    return
  }
  await checkConnection()
}

async function loadCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  state.tab = tabs[0] ?? null
  const pageUrl = api.normalizePageUrl(state.tab?.url)
  state.pageValid = Boolean(pageUrl)
  elements.pageCard.dataset.invalid = String(!state.pageValid)

  if (!state.pageValid) {
    elements.pageKind.textContent = '不可收藏'
    elements.pageHost.textContent = '受保护页面'
    elements.title.textContent = '当前标签页不是普通网页'
    elements.url.textContent = 'Chrome 内部页、本地文件和浏览器设置不能发送到轻画'
    updateClipButton()
    return
  }

  const title = String(state.tab.title || '').trim() || pageUrl
  elements.pageKind.textContent = '当前网页'
  elements.pageHost.textContent = hostOf(pageUrl)
  elements.title.textContent = title
  elements.title.title = title
  elements.url.textContent = pageUrl
  elements.url.title = pageUrl
  updateClipButton()
}

async function checkConnection() {
  if (state.checking) return
  const endpoint = api.normalizeEndpoint(elements.endpoint.value)
  if (!endpoint) {
    setStatus('本机地址必须是 127.0.0.1:53684', 'error')
    elements.settings.open = true
    state.online = false
    updateClipButton()
    return
  }

  state.checking = true
  state.online = false
  elements.retry.disabled = true
  setStatus('正在连接轻画桌面端…', 'checking')
  updateClipButton()
  try {
    await api.checkReceiver(endpoint)
    state.online = true
    state.tokenConfigured = Boolean(elements.token.value.trim())
    setStatus(
      state.tokenConfigured ? '轻画已连接，可以收藏' : '接收端在线，等待配对令牌',
      state.tokenConfigured ? 'online' : 'idle',
    )
  } catch (error) {
    state.online = false
    setStatus(api.errorText(error), 'error')
  } finally {
    state.checking = false
    elements.retry.disabled = false
    updateClipButton()
  }
}

async function clipCurrentPage() {
  if (!state.pageValid || state.clipping || !state.tab) return
  const config = await chrome.storage.local.get({
    endpoint: api.DEFAULT_ENDPOINT,
    token: '',
  })
  const endpoint = api.normalizeEndpoint(elements.endpoint.value)
  const token = String(config.token || '').trim()
  if (!endpoint || !token) {
    elements.settings.open = true
    setStatus(!endpoint ? '本机地址无效' : '先填写配对令牌', 'error')
    return
  }

  state.clipping = true
  elements.clip.dataset.busy = 'true'
  elements.clipLabel.textContent = '正在发送到轻画…'
  setStatus('正在发送当前网页…', 'checking')
  updateClipButton()
  try {
    await api.clipPage({
      endpoint,
      token,
      url: state.tab.url,
      title: state.tab.title || '',
    })
    const now = Date.now()
    const last = {
      lastClipAt: now,
      lastClipTitle: state.tab.title || state.tab.url,
      lastClipUrl: state.tab.url,
      lastClipStatus: 'sent',
      lastClipError: '',
    }
    await chrome.storage.local.set(last)
    state.online = true
    setStatus('已发送，轻画正在采集网页图片', 'online')
    showLastClip(last)
  } catch (error) {
    const last = {
      lastClipAt: Date.now(),
      lastClipStatus: 'error',
      lastClipError: api.errorText(error),
    }
    await chrome.storage.local.set(last)
    setStatus(api.errorText(error), 'error')
    showLastClip(last)
    if (error?.code === 'offline' || error?.code === 'timeout') {
      state.online = false
    }
    if (error?.code === 'auth' || error?.code === 'not-paired' || error?.code === 'endpoint') {
      elements.settings.open = true
    }
  } finally {
    state.clipping = false
    elements.clip.dataset.busy = 'false'
    elements.clipLabel.textContent = '收藏到轻画'
    updateClipButton()
  }
}

async function startDragCollection() {
  if (
    !state.pageValid
    || !state.tokenConfigured
    || !state.online
    || state.injecting
  ) {
    return
  }
  state.injecting = true
  elements.drag.dataset.busy = 'true'
  elements.dragLabel.textContent = '正在打开投放区…'
  setStatus('正在当前网页开启拖拽投放区…', 'checking')
  updateClipButton()
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'qinghua:start-drag',
    })
    if (!result?.ok) throw new Error(result?.error || '当前网页无法开启投放区')
    setStatus('投放区已打开，回到网页把图片拖进去', 'online')
    window.setTimeout(() => window.close(), 650)
  } catch (error) {
    setStatus(api.errorText(error), 'error')
  } finally {
    state.injecting = false
    elements.drag.dataset.busy = 'false'
    elements.dragLabel.textContent = '拖拽图片收藏'
    updateClipButton()
  }
}

async function saveSettings() {
  const endpoint = api.normalizeEndpoint(elements.endpoint.value)
  const token = elements.token.value.trim()
  if (!endpoint) {
    setStatus('本机地址必须是 127.0.0.1:53684', 'error')
    return
  }
  if (!token) {
    setStatus('配对令牌不能为空', 'error')
    return
  }

  elements.save.disabled = true
  elements.save.textContent = '正在保存…'
  try {
    await chrome.storage.local.set({ endpoint, token })
    elements.endpoint.value = endpoint
    elements.token.value = token
    state.tokenConfigured = true
    elements.settings.open = false
    setStatus('设置已保存，正在检测连接…', 'checking')
    await checkConnection()
  } finally {
    elements.save.disabled = false
    elements.save.textContent = '保存并检测'
  }
}

async function clearSettings() {
  await chrome.storage.local.set({
    endpoint: api.DEFAULT_ENDPOINT,
    token: '',
    lastClipStatus: '',
    lastClipError: '',
  })
  elements.endpoint.value = api.DEFAULT_ENDPOINT
  elements.token.value = ''
  state.tokenConfigured = false
  state.online = false
  elements.settings.open = true
  elements.lastResult.hidden = true
  setStatus('配对令牌已清除', 'idle')
  updateClipButton()
}

function toggleTokenVisibility() {
  const showing = elements.token.type === 'text'
  elements.token.type = showing ? 'password' : 'text'
  elements.toggleToken.setAttribute('aria-pressed', String(!showing))
  elements.toggleToken.setAttribute('aria-label', showing ? '显示配对令牌' : '隐藏配对令牌')
  elements.toggleToken.title = showing ? '显示配对令牌' : '隐藏配对令牌'
}

function updateClipButton() {
  elements.clip.disabled =
    !state.pageValid ||
    !state.tokenConfigured ||
    !state.online ||
    state.checking ||
    state.clipping
  elements.drag.disabled =
    !state.pageValid ||
    !state.tokenConfigured ||
    !state.online ||
    state.checking ||
    state.clipping ||
    state.injecting
}

function showLastClip(config) {
  if (!config.lastClipAt) {
    elements.lastResult.hidden = true
    return
  }
  const when = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(config.lastClipAt))
  elements.lastResult.hidden = false
  elements.lastResult.dataset.state = config.lastClipStatus === 'error' ? 'error' : 'sent'
  elements.lastResult.textContent = config.lastClipStatus === 'error'
    ? `上次收藏失败 · ${when} · ${config.lastClipError || '未知错误'}`
    : `上次发送 · ${when} · ${config.lastClipTitle || '当前网页'}`
}

function setStatus(text, stateName) {
  elements.status.textContent = text
  elements.dot.dataset.state = stateName
}

function hostOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '')
  } catch {
    return '网页'
  }
}

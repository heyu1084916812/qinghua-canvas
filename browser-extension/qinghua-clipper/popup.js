/* global chrome, document, fetch, URL */
const DEFAULT_ENDPOINT = 'http://127.0.0.1:53684/clip'

const elements = {
  status: document.querySelector('#status'),
  dot: document.querySelector('#status-dot'),
  title: document.querySelector('#page-title'),
  url: document.querySelector('#page-url'),
  clip: document.querySelector('#clip'),
  settings: document.querySelector('#settings'),
  endpoint: document.querySelector('#endpoint'),
  token: document.querySelector('#token'),
  save: document.querySelector('#save'),
}

let currentTab = null

void initialize()

async function initialize() {
  const config = await chrome.storage.local.get({
    endpoint: DEFAULT_ENDPOINT,
    token: '',
  })
  elements.endpoint.value = config.endpoint
  elements.token.value = config.token
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  currentTab = tabs[0] ?? null
  if (!currentTab?.url || !/^https?:\/\//i.test(currentTab.url)) {
    setStatus('当前页面不是可收藏的网页', 'error')
    elements.clip.disabled = true
    return
  }
  elements.title.textContent = currentTab.title || currentTab.url
  elements.title.title = currentTab.title || currentTab.url
  elements.url.textContent = currentTab.url
  elements.url.title = currentTab.url
  if (!config.token) {
    elements.settings.open = true
    setStatus('先填写轻画显示的配对令牌', 'error')
    elements.clip.disabled = true
    return
  }
  setStatus('等待收藏')
  await checkReceiver(config.endpoint)
}

elements.save.addEventListener('click', async () => {
  const endpoint = normalizeEndpoint(elements.endpoint.value)
  const token = elements.token.value.trim()
  if (!endpoint) {
    setStatus('接收端地址无效', 'error')
    return
  }
  if (!token) {
    setStatus('配对令牌不能为空', 'error')
    return
  }
  await chrome.storage.local.set({ endpoint, token })
  elements.endpoint.value = endpoint
  setStatus('设置已保存')
  elements.clip.disabled = !currentTab?.url
  await checkReceiver(endpoint)
})

elements.clip.addEventListener('click', async () => {
  if (!currentTab?.url || !/^https?:\/\//i.test(currentTab.url)) return
  const config = await chrome.storage.local.get({
    endpoint: DEFAULT_ENDPOINT,
    token: '',
  })
  if (!config.token) {
    elements.settings.open = true
    setStatus('先填写配对令牌', 'error')
    return
  }
  elements.clip.disabled = true
  setStatus('正在发送到轻画…')
  try {
    const response = await fetch(normalizeEndpoint(config.endpoint), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Qinghua-Clipper-Token': config.token,
      },
      body: JSON.stringify({
        url: currentTab.url,
        title: currentTab.title || '',
      }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || result.ok !== true) {
      throw new Error(result.error || `轻画接收失败：HTTP ${response.status}`)
    }
    setStatus('已发送，轻画会自动采集页面图片', 'online')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    elements.clip.disabled = false
  }
})

async function checkReceiver(endpoint) {
  const url = new URL(normalizeEndpoint(endpoint))
  url.pathname = '/health'
  url.search = ''
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error('offline')
    elements.dot.dataset.online = 'true'
  } catch {
    elements.dot.dataset.online = 'false'
    setStatus('轻画桌面端未运行或接收端未启动', 'error')
  }
}

function normalizeEndpoint(value) {
  try {
    const url = new URL(String(value).trim())
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return ''
    url.pathname = '/clip'
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function setStatus(text, state = '') {
  elements.status.textContent = text
  elements.dot.dataset.error = state === 'error' ? 'true' : 'false'
  if (state === 'online') elements.dot.dataset.online = 'true'
}

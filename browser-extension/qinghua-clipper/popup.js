/* global chrome, document, QinghuaClipper, window */
const api = QinghuaClipper
const HOST_ORIGINS = ['http://*/*', 'https://*/*']

const elements = {
  status: document.querySelector('#status'),
  dot: document.querySelector('#status-dot'),
  toggle: document.querySelector('#drag-mode'),
  hint: document.querySelector('#hint'),
}

const state = {
  connected: false,
  busy: false,
}

elements.toggle.addEventListener('change', () => void setDragMode(elements.toggle.checked))
void initialize()

async function initialize() {
  const { dragMode } = await chrome.storage.local.get({ dragMode: false })
  elements.toggle.checked = Boolean(dragMode)
  await connect()
  updateHint()
  const timer = window.setInterval(() => void connect(), 4_000)
  window.addEventListener('unload', () => window.clearInterval(timer), { once: true })
}

async function connect() {
  if (state.busy) return
  state.busy = true
  setStatus('正在连接轻画', 'checking')
  try {
    const result = await chrome.runtime.sendMessage({ type: 'qinghua:connect' })
    if (!result?.ok) throw new Error(result?.error || '轻画未连接')
    state.connected = true
    setStatus('轻画已连接', 'online')
  } catch {
    state.connected = false
    setStatus('打开轻画后会自动连接', 'error')
  } finally {
    state.busy = false
    updateHint()
  }
}

async function setDragMode(enabled) {
  elements.toggle.disabled = true
  try {
    if (enabled) {
      const granted = await chrome.permissions.request({ origins: HOST_ORIGINS })
      if (!granted) throw new Error('需要允许轻画访问网页才能拖拽收藏')
    }
    const result = await chrome.runtime.sendMessage({
      type: 'qinghua:set-drag-mode',
      enabled,
    })
    if (!result?.ok) throw new Error(result?.error || '拖拽收藏设置失败')
  } catch (error) {
    elements.toggle.checked = !enabled
    setStatus(dragModeError(error), 'error')
  } finally {
    elements.toggle.disabled = false
    updateHint()
  }
}

function dragModeError(error) {
  const message = api.errorText(error)
  if (message.includes('Only permissions specified in the manifest may be requested')) {
    return '扩展版本过旧，请在扩展管理页重新加载轻画 Clipper'
  }
  return message
}

function updateHint() {
  if (!elements.toggle.checked) {
    elements.hint.textContent = '开启后，把网页图片拖到页面中间'
    return
  }
  elements.hint.textContent = state.connected
    ? '拖动网页图片，松手即收藏'
    : '拖拽已开启，打开轻画后会自动连接'
}

function setStatus(text, stateName) {
  elements.status.textContent = text
  elements.dot.dataset.state = stateName
}

/* global chrome, document, Element, HTMLImageElement, location, URL, window */
(() => {
  const HOST_ID = 'qinghua-clipper-drop-target'
  if (document.getElementById(HOST_ID)) return

  let hideTimer = 0
  let lastDraggedImage = ''
  let keepAfterDrop = false
  const host = document.createElement('div')
  host.id = HOST_ID
  host.dataset.qinghuaDropTarget = 'true'
  host.dataset.qinghuaDropReady = 'true'
  host.style.setProperty('all', 'initial', 'important')
  host.style.setProperty('position', 'fixed', 'important')
  host.style.setProperty('inset', '0', 'important')
  host.style.setProperty('z-index', '2147483647', 'important')
  host.style.setProperty('pointer-events', 'none', 'important')

  const shadow = host.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <style>
      :host { color-scheme: light dark; }
      * { box-sizing: border-box; }
      .backdrop {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        background: rgba(18, 20, 17, .26);
        pointer-events: none;
      }
      .backdrop[hidden] { display: none; }
      .dropbox {
        display: grid;
        place-items: center;
        width: min(320px, calc(100vw - 40px));
        min-height: 136px;
        padding: 24px;
        border: 1px solid #d9dbd3;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 20px 64px rgba(0,0,0,.26);
        color: #171814;
        font: 13px/1.45 ui-sans-serif, system-ui, "Segoe UI", sans-serif;
        text-align: center;
        pointer-events: auto;
        transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
      }
      .dropbox[data-over="true"] {
        border-color: #171814;
        background: #f4f4f0;
        transform: scale(1.01);
      }
      strong { display: block; font-size: 16px; font-weight: 680; }
      p {
        min-height: 18px;
        margin: 6px 0 0;
        color: #666b62;
        font-size: 12px;
      }
      p[data-error="true"] { color: #9b3c32; }
      @media (prefers-color-scheme: dark) {
        .dropbox { border-color: #3a3f37; background: #20231e; color: #f1f2ec; }
        .dropbox[data-over="true"] { border-color: #f1f2ec; background: #282c26; }
        p { color: #a5aaa0; }
        p[data-error="true"] { color: #e69a90; }
      }
      @media (prefers-reduced-motion: reduce) {
        .dropbox { transition: none; }
      }
    </style>
    <div class="backdrop" data-qinghua-drop-backdrop hidden>
      <section class="dropbox" data-qinghua-drop-box role="region" aria-label="轻画拖拽收藏">
        <strong>把图片放到这里</strong>
        <p data-qinghua-drop-status role="status" aria-live="polite">
          松手后会直接收藏到轻画
        </p>
      </section>
    </div>
  `

  const backdrop = shadow.querySelector('.backdrop')
  const dropbox = shadow.querySelector('.dropbox')
  const status = shadow.querySelector('[data-qinghua-drop-status]')

  const setStatus = (text, error = false) => {
    status.textContent = text
    status.dataset.error = String(error)
    host.dataset.qinghuaDropStatus = text
    host.dataset.qinghuaDropError = String(error)
  }

  const show = () => {
    window.clearTimeout(hideTimer)
    backdrop.hidden = false
    host.dataset.qinghuaDropVisible = 'true'
    setStatus('松手后会直接收藏到轻画')
  }

  const hide = () => {
    window.clearTimeout(hideTimer)
    backdrop.hidden = true
    dropbox.dataset.over = 'false'
    host.dataset.qinghuaDropVisible = 'false'
  }

  const delayedHide = () => {
    if (keepAfterDrop) return
    window.clearTimeout(hideTimer)
    hideTimer = window.setTimeout(hide, 180)
  }

  const onDragStart = (event) => {
    const element = event.target instanceof Element ? event.target : null
    const image = element?.closest('img')
    if (image instanceof HTMLImageElement) {
      lastDraggedImage = image.currentSrc || image.src || ''
    } else {
      lastDraggedImage = ''
    }
    if (!image && !looksLikeImageDrag(event.dataTransfer)) return
    keepAfterDrop = false
    show()
  }

  const onDragOver = (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    dropbox.dataset.over = 'true'
  }

  const onDragLeave = () => {
    dropbox.dataset.over = 'false'
  }

  const onDrop = async (event) => {
    event.preventDefault()
    event.stopPropagation()
    window.clearTimeout(hideTimer)
    keepAfterDrop = true
    dropbox.dataset.over = 'false'
    const imageUrl = imageUrlOf(event.dataTransfer)
    if (!imageUrl) {
      setStatus('没有识别到图片地址，请直接拖动网页图片', true)
      return
    }
    setStatus('正在收藏到轻画…')
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'qinghua:clip-image',
        pageUrl: location.href,
        imageUrl,
        title: document.title,
      })
      if (!response?.ok) throw new Error(response?.error || '轻画没有接收这张图片')
      setStatus('已收藏到轻画')
      hideTimer = window.setTimeout(hide, 900)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true)
    }
  }

  const onKeyDown = (event) => {
    if (event.key === 'Escape') hide()
  }

  const onMessage = (message) => {
    if (message?.type === 'qinghua:disable-drag') teardown()
  }

  const teardown = () => {
    window.clearTimeout(hideTimer)
    document.removeEventListener('dragstart', onDragStart, true)
    document.removeEventListener('dragend', delayedHide, true)
    document.removeEventListener('drop', delayedHide, true)
    document.removeEventListener('keydown', onKeyDown, true)
    host.removeEventListener('dragover', onDragOver)
    host.removeEventListener('dragleave', onDragLeave)
    host.removeEventListener('drop', onDrop)
    chrome.runtime.onMessage.removeListener(onMessage)
    host.remove()
  }

  document.addEventListener('dragstart', onDragStart, true)
  document.addEventListener('dragend', delayedHide, true)
  document.addEventListener('drop', delayedHide, true)
  document.addEventListener('keydown', onKeyDown, true)
  host.addEventListener('dragover', onDragOver)
  host.addEventListener('dragleave', onDragLeave)
  host.addEventListener('drop', onDrop)
  chrome.runtime.onMessage.addListener(onMessage)
  document.documentElement.appendChild(host)
  hide()

  function looksLikeImageDrag(dataTransfer) {
    if (!dataTransfer) return false
    const types = [...dataTransfer.types]
    return types.includes('Files')
      || types.includes('text/uri-list')
      || types.includes('text/html')
  }

  function imageUrlOf(dataTransfer) {
    if (!dataTransfer) return ''
    const uriList = dataTransfer.getData('text/uri-list')
      .split(/\r?\n/)
      .find((line) => line && !line.startsWith('#'))
    const html = dataTransfer.getData('text/html')
    const plain = dataTransfer.getData('text/plain')
    return normalizeImageUrl(uriList)
      || normalizeImageUrl(htmlImageSource(html))
      || normalizeImageUrl(plain)
      || normalizeImageUrl(lastDraggedImage)
  }

  function htmlImageSource(html) {
    if (!html) return ''
    const template = document.createElement('template')
    template.innerHTML = html
    const image = template.content.querySelector('img')
    return image?.getAttribute('src') || ''
  }

  function normalizeImageUrl(value) {
    const raw = String(value || '').trim()
    if (!raw || raw.length > 2048) return ''
    try {
      const url = new URL(raw, location.href)
      return url.protocol === 'http:' || url.protocol === 'https:'
        ? url.toString()
        : ''
    } catch {
      return ''
    }
  }
})()

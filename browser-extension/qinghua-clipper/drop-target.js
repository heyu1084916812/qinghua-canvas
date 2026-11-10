/* global chrome, CustomEvent, document, Element, HTMLImageElement, location, URL, window */
(() => {
  const HOST_ID = 'qinghua-clipper-drop-target'
  const existing = document.getElementById(HOST_ID)
  if (existing) {
    existing.dispatchEvent(new CustomEvent('qinghua:drop-flash'))
    return
  }

  let lastDraggedImage = ''
  const host = document.createElement('div')
  host.id = HOST_ID
  host.dataset.qinghuaDropTarget = 'true'
  host.style.setProperty('all', 'initial', 'important')
  host.style.setProperty('position', 'fixed', 'important')
  host.style.setProperty('right', '20px', 'important')
  host.style.setProperty('bottom', '20px', 'important')
  host.style.setProperty('z-index', '2147483647', 'important')

  const shadow = host.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <style>
      :host { color-scheme: light dark; }
      * { box-sizing: border-box; }
      .target {
        width: 248px;
        padding: 13px;
        border: 1px solid #c9cdc5;
        border-radius: 9px;
        background: #fff;
        box-shadow: 0 10px 30px rgba(22, 24, 20, .18);
        color: #171814;
        font: 13px/1.4 ui-sans-serif, system-ui, "Segoe UI", sans-serif;
        transition: border-color 140ms ease, transform 140ms ease, background 140ms ease;
      }
      .target[data-over="true"] {
        border-color: #39775a;
        background: #eef7f1;
        transform: translateY(-3px);
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 9px;
      }
      strong { font-size: 13px; font-weight: 680; }
      button {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: #6c7168;
        cursor: pointer;
      }
      button:hover { background: #eff0eb; color: #171814; }
      button:focus-visible { outline: 2px solid #4a8267; outline-offset: 1px; }
      svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      .zone {
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr);
        align-items: center;
        gap: 10px;
        min-height: 58px;
        padding: 9px;
        border: 1px dashed #bfc4ba;
        border-radius: 7px;
        background: #f6f6f2;
      }
      .zone svg { width: 22px; height: 22px; color: #39775a; }
      .zone span { display: grid; gap: 2px; min-width: 0; }
      .zone b { font-size: 12px; font-weight: 650; }
      .zone small { color: #6c7168; font-size: 10.5px; line-height: 1.45; }
      .status { min-height: 15px; margin: 8px 1px 0; color: #6c7168; font-size: 10.5px; }
      .status[data-error="true"] { color: #a74439; }
      @media (prefers-color-scheme: dark) {
        .target { border-color: #3c423a; background: #20231e; color: #f1f2ec; box-shadow: 0 10px 30px rgba(0, 0, 0, .42); }
        .target[data-over="true"] { border-color: #80bd99; background: #24372b; }
        button { color: #a5aaa0; }
        button:hover { background: #2b3029; color: #f1f2ec; }
        button:focus-visible { outline-color: #8bc9a5; }
        .zone { border-color: #4c5349; background: #282c26; }
        .zone svg { color: #80bd99; }
        .zone small, .status { color: #a5aaa0; }
        .status[data-error="true"] { color: #e69a90; }
      }
      @media (prefers-reduced-motion: reduce) {
        .target { transition: none; }
      }
    </style>
    <aside class="target" data-qinghua-drop-zone>
      <header>
        <strong>收藏图片到轻画</strong>
        <button type="button" aria-label="关闭拖拽投放区" title="关闭">
          <svg viewBox="0 0 24 24"><path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/></svg>
        </button>
      </header>
      <div class="zone">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5.5h10.5v10H4z"/>
          <path d="m5.8 13.5 2.8-2.8 2.1 2.1 1.8-1.8 2 2"/>
          <path d="M18 4v10M14.5 10.5 18 14l3.5-3.5"/>
        </svg>
        <span>
          <b>把图片拖到这里</b>
          <small>释放后直接收藏到「我的素材 → 轻画插件」</small>
        </span>
      </div>
      <p class="status" role="status" aria-live="polite">只读取图片地址，不读取 Cookie</p>
    </aside>
  `

  const target = shadow.querySelector('.target')
  const status = shadow.querySelector('.status')
  const close = shadow.querySelector('button')

  const setStatus = (text, error = false) => {
    status.textContent = text
    status.dataset.error = String(error)
    host.dataset.qinghuaDropStatus = text
    host.dataset.qinghuaDropError = String(error)
  }

  const onDragStart = (event) => {
    const element = event.target instanceof Element ? event.target : null
    const image = element?.closest('img')
    if (!(image instanceof HTMLImageElement)) return
    lastDraggedImage = image.currentSrc || image.src || ''
    target.dataset.over = 'true'
    setStatus('松手后收藏这张图片')
  }

  const onDragEnd = () => {
    target.dataset.over = 'false'
  }

  const onDragOver = (event) => {
    if (!event.composedPath().includes(host)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    target.dataset.over = 'true'
  }

  const onDragLeave = (event) => {
    if (event.relatedTarget && host.contains(event.relatedTarget)) return
    target.dataset.over = 'false'
  }

  const onDrop = async (event) => {
    if (!event.composedPath().includes(host)) return
    event.preventDefault()
    event.stopPropagation()
    target.dataset.over = 'false'
    const imageUrl = imageUrlOf(event.dataTransfer)
    if (!imageUrl) {
      setStatus('没有识别到图片地址，请直接拖动网页里的图片', true)
      return
    }
    setStatus('正在发送到轻画…')
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'qinghua:clip-image',
        pageUrl: location.href,
        imageUrl,
        title: document.title,
      })
      if (!response?.ok) throw new Error(response?.error || '轻画没有接收这张图片')
      setStatus('已收藏到「我的素材 → 轻画插件」')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true)
    }
  }

  const teardown = () => {
    document.removeEventListener('dragstart', onDragStart, true)
    document.removeEventListener('dragend', onDragEnd, true)
    document.removeEventListener('dragover', onDragOver, true)
    document.removeEventListener('dragleave', onDragLeave, true)
    document.removeEventListener('drop', onDrop, true)
    host.remove()
  }
  const flash = () => {
    target.dataset.over = 'true'
    setStatus('投放区已经打开，直接把图片拖进来')
    window.setTimeout(() => {
      target.dataset.over = 'false'
      setStatus('只读取图片地址，不读取 Cookie')
    }, 1_200)
  }

  close.addEventListener('click', teardown)
  host.addEventListener('qinghua:drop-flash', flash)
  document.addEventListener('dragstart', onDragStart, true)
  document.addEventListener('dragend', onDragEnd, true)
  document.addEventListener('dragover', onDragOver, true)
  document.addEventListener('dragleave', onDragLeave, true)
  document.addEventListener('drop', onDrop, true)
  document.documentElement.appendChild(host)
  host.dataset.qinghuaDropReady = 'true'

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

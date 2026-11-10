/* global chrome, document, Element, fetch, getComputedStyle, location, URL, window */
(() => {
  const HOST_ID = 'qinghua-clipper-drop-target'
  const IMAGE_ATTRIBUTES = [
    'data-original',
    'data-actualsrc',
    'data-original-src',
    'data-src',
    'data-lazy-src',
    'data-echo',
    'data-hi-res-src',
    'data-large-src',
    'data-full-src',
    'data-zoom-image',
    'data-origin',
    'data-image-url',
    'data-image',
    'data-pin-media',
  ]
  const IMAGE_CONTEXT_SELECTOR = [
    'a',
    'picture',
    'figure',
    'article',
    'li',
    '[data-pin-id]',
    '[data-testid*="pin"]',
    '[class*="pin"]',
    '[class*="card"]',
    '[class*="item"]',
  ].join(',')
  if (document.getElementById(HOST_ID)) return

  let hideTimer = 0
  let draggedImageUrls = []
  let draggedHuabanPinId = ''
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
    draggedImageUrls = imageUrlsForDrag(event)
    draggedHuabanPinId = huabanPinIdNearPoint(event)
    if (draggedImageUrls.length === 0 && !looksLikeImageDrag(event.dataTransfer)) return
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
    let sourceImageUrls = []
    if (draggedHuabanPinId) {
      setStatus('正在读取花瓣原图…')
      sourceImageUrls = await huabanOriginalUrls(draggedHuabanPinId)
    }
    const candidateUrls = uniqueImageUrls([
      ...sourceImageUrls,
      ...draggedImageUrls,
      imageUrlOf(event.dataTransfer),
    ])
    const imageUrl = candidateUrls[0] || ''
    if (!imageUrl) {
      setStatus('没有识别到内容原图，请拖动图片本体而不是头像或站点图标', true)
      return
    }
    setStatus('正在收藏到轻画…')
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'qinghua:clip-image',
        pageUrl: location.href,
        imageUrl,
        imageUrls: candidateUrls,
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
    const directImage = draggedImageUrls.map(imageCandidate).find(Boolean)
    if (directImage) return directImage
    const uriList = dataTransfer.getData('text/uri-list')
      .split(/\r?\n/)
      .find((line) => line && !line.startsWith('#'))
    const html = dataTransfer.getData('text/html')
    const plain = dataTransfer.getData('text/plain')
    return htmlImageUrls(html).map(imageCandidate).find(Boolean)
      || imageCandidate(uriList)
      || imageCandidate(plain)
  }

  function imageUrlsForDrag(event) {
    const point = { x: event.clientX, y: event.clientY }
    const candidates = []
    const seenImages = new Set()
    const seenBackgrounds = new Set()

    const addImage = (image, bonus) => {
      if (!image || seenImages.has(image)) return
      seenImages.add(image)
      const urls = imageSourceUrls(image)
      if (urls.length === 0) return
      candidates.push({
        score: imageScore(image, point, bonus),
        urls,
      })
    }
    const addBackground = (url, element, bonus) => {
      const normalized = imageCandidate(url)
      if (!normalized || seenBackgrounds.has(normalized)) return
      seenBackgrounds.add(normalized)
      candidates.push({
        score: elementScore(element, point, bonus),
        urls: withUpgradedImageUrl(normalized),
      })
    }

    const target = event.target instanceof Element ? event.target : null
    const underPointer = document.elementFromPoint(point.x, point.y)
    addImage(imageElementOf(target, point), 50_000_000)
    addImage(imageElementOf(underPointer, point), 40_000_000)

    for (const element of document.elementsFromPoint(point.x, point.y).slice(0, 8)) {
      addImage(imageElementOf(element, point), 20_000_000)
      const background = backgroundImageUrlOf(element)
      if (background) addBackground(background, element, 10_000_000)
    }

    let context = target?.closest(IMAGE_CONTEXT_SELECTOR)
      || (underPointer instanceof Element
        ? underPointer.closest(IMAGE_CONTEXT_SELECTOR)
        : null)
    for (let depth = 0; context && depth < 4; depth += 1) {
      for (const image of context.querySelectorAll('img, input[type="image"]')) {
        addImage(image, 0)
      }
      context = context.parentElement?.closest(IMAGE_CONTEXT_SELECTOR)
    }

    candidates.sort((left, right) => right.score - left.score)
    return candidates[0]?.urls ?? []
  }

  function htmlImageUrls(html) {
    if (!html) return []
    const template = document.createElement('template')
    template.innerHTML = html
    return [...template.content.querySelectorAll('img, input[type="image"]')]
      .flatMap(imageSourceUrls)
      .filter(Boolean)
  }

  function huabanPinIdNearPoint(event) {
    if (!isHuabanPage()) return ''
    const point = { x: event.clientX, y: event.clientY }
    const elements = [
      event.target instanceof Element ? event.target : null,
      document.elementFromPoint(point.x, point.y),
      ...document.elementsFromPoint(point.x, point.y).slice(0, 8),
    ].filter((element) => element instanceof Element)

    for (const element of elements) {
      const link = element.closest('a[href*="/pins/"]')
      const match = link?.getAttribute('href')?.match(/\/pins\/(\d+)(?:[/?#]|$)/)
      if (match?.[1]) return match[1]
      const dataPinId = element.closest('[data-pin-id]')?.getAttribute('data-pin-id')
      if (/^\d+$/.test(dataPinId || '')) return dataPinId
    }
    return ''
  }

  async function huabanOriginalUrls(pinId) {
    try {
      const response = await fetch(`/v3/pins/${encodeURIComponent(pinId)}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) return []
      const payload = await response.json()
      const file = payload?.pin?.file
      if (!file) return []
      const urls = []
      if (typeof file.url === 'string') urls.push(file.url)
      if (typeof file.key === 'string' && file.key.trim()) {
        const key = file.key.trim().replace(/^\/+/, '')
        urls.push(`https://gd-hbimg-edge.huaban.com/${key}`)
      }
      return uniqueImageUrls(urls)
    } catch {
      return []
    }
  }

  function isHuabanPage() {
    const host = location.hostname.toLowerCase()
    return host === 'huaban.com' || host.endsWith('.huaban.com')
  }

  function imageElementOf(node, point) {
    if (!(node instanceof Element)) return null
    const direct = node.closest('img, input[type="image"]')
    if (direct) return direct
    const bounds = node.getBoundingClientRect()
    if (
      bounds.width * bounds.height
      > Math.max(1, window.innerWidth * window.innerHeight) * 0.55
    ) {
      return null
    }
    return [...node.querySelectorAll('img, input[type="image"]')]
      .filter((image) => {
        const rect = image.getBoundingClientRect()
        return rect.width >= 32
          && rect.height >= 32
          && rect.bottom > 0
          && rect.right > 0
          && rect.top < window.innerHeight
          && rect.left < window.innerWidth
      })
      .sort((left, right) => imageScore(right, point) - imageScore(left, point))[0]
      || null
  }

  function imageSourceUrls(image) {
    if (isRejectedImageElement(image)) return []
    const urls = []
    const add = (value) => {
      const normalized = imageCandidate(value)
      if (!normalized) return
      for (const candidate of withUpgradedImageUrl(normalized)) {
        if (!urls.includes(candidate)) urls.push(candidate)
      }
    }
    for (const attribute of IMAGE_ATTRIBUTES) {
      const value = image.getAttribute(attribute)
      if (value) add(value)
    }
    const picture = image.closest('picture')
    if (picture) {
      const source = [...picture.querySelectorAll('source')]
        .map((item) => ({
          srcset: item.getAttribute('srcset'),
          media: item.getAttribute('media'),
        }))
        .find((item) => item.srcset && !/max-width/i.test(item.media || ''))
      if (source?.srcset) add(bestSrcsetUrl(source.srcset))
    }
    if (image.getAttribute('srcset')) add(bestSrcsetUrl(image.getAttribute('srcset')))
    add(image.currentSrc)
    add(image.getAttribute('src'))
    const link = image.closest('a[href]')
    const href = link?.getAttribute('href')
    if (href && looksLikeImageUrl(href)) add(href)
    return urls
  }

  function bestSrcsetUrl(value) {
    const candidates = String(value || '').split(',').map((candidate) => {
      const [url, descriptor = '1x'] = candidate.trim().split(/\s+/)
      const weight = Number.parseFloat(descriptor) || 1
      return { url, weight: descriptor.endsWith('w') ? weight : weight * 1000 }
    }).filter((candidate) => candidate.url)
    candidates.sort((left, right) => right.weight - left.weight)
    return candidates[0]?.url || ''
  }

  function withUpgradedImageUrl(value) {
    const upgraded = upgradeImageUrl(value)
    return upgraded && upgraded !== value ? [upgraded, value] : [value]
  }

  function upgradeImageUrl(value) {
    try {
      const url = new URL(value, location.href)
      const host = url.hostname.toLowerCase()
      if (
        host === 'gd-hbimg.huaban.com'
        || host === 'gd-hbimg-edge.huaban.com'
        || host === 'hbimg.huaban.com'
        || host === 'hbimg.huabanimg.com'
        || host === 'img.hb.aicdn.com'
      ) {
        url.pathname = url.pathname.replace(/_?(?:fw|sq|w|h)\d+[a-z0-9]*$/i, '')
      }
      if (host === 'i.pinimg.com') {
        url.pathname = url.pathname.replace(
          /\/(?:236x|474x|564x|736x|1200x)\//i,
          '/originals/',
        )
      }
      return url.toString()
    } catch {
      return value
    }
  }

  function backgroundImageUrlOf(node) {
    let current = node
    while (current && current !== document.documentElement) {
      if (current instanceof Element) {
        const matches = [...getComputedStyle(current).backgroundImage
          .matchAll(/url\(["']?(.+?)["']?\)/g)]
        const image = matches.map((match) => match[1]).find((value) => imageCandidate(value))
        if (image) return image
      }
      current = current.parentElement
    }
    return ''
  }

  function imageScore(image, point, bonus = 0) {
    const rect = image.getBoundingClientRect()
    const renderedArea = Math.max(0, rect.width) * Math.max(0, rect.height)
    if (renderedArea === 0) return Number.NEGATIVE_INFINITY
    const naturalArea = Math.max(0, image.naturalWidth) * Math.max(0, image.naturalHeight)
    const pointerInside = point
      && point.x >= rect.left
      && point.x <= rect.right
      && point.y >= rect.top
      && point.y <= rect.bottom
    let score = bonus
      + Math.min(renderedArea, window.innerWidth * window.innerHeight) * 10
      + Math.min(naturalArea, 20_000_000)
    if (pointerInside) score += 20_000_000
    if (rect.width < 64 || rect.height < 64) score -= 8_000_000
    if (looksLikeUiImage(image) && (rect.width < 120 || rect.height < 120)) {
      score -= 30_000_000
    }
    return score
  }

  function elementScore(element, point, bonus) {
    if (!(element instanceof Element)) return Number.NEGATIVE_INFINITY
    const rect = element.getBoundingClientRect()
    const area = Math.max(0, rect.width) * Math.max(0, rect.height)
    const pointerInside = point
      && point.x >= rect.left
      && point.x <= rect.right
      && point.y >= rect.top
      && point.y <= rect.bottom
    return bonus
      + Math.min(area, window.innerWidth * window.innerHeight) * 10
      + (pointerInside ? 20_000_000 : 0)
  }

  function looksLikeUiImage(image) {
    const marker = [
      image.getAttribute('class'),
      image.getAttribute('id'),
      image.getAttribute('alt'),
      image.getAttribute('role'),
    ].filter(Boolean).join(' ')
    return /(?:^|[\s_-])(avatar|logo|icon|emoji|sprite|favicon|profile|badge)(?:$|[\s_-])/i
      .test(marker)
  }

  function looksLikeImageUrl(value) {
    try {
      const url = new URL(value, location.href)
      return /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(url.pathname)
    } catch {
      return false
    }
  }

  function imageCandidate(value) {
    const url = normalizeImageUrl(value)
    if (!url) return ''
    if (isRejectedImageUrl(url)) return ''
    try {
      const candidate = new URL(url)
      const page = new URL(location.href)
      if (candidate.href === page.href) return ''
      if (
        candidate.hostname === page.hostname
        && candidate.pathname === page.pathname
        && candidate.search === page.search
      ) {
        return ''
      }
    } catch {
      return ''
    }
    return url
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

  function uniqueImageUrls(values) {
    const urls = []
    for (const value of values) {
      const candidate = imageCandidate(value)
      if (candidate && !urls.includes(candidate)) urls.push(candidate)
    }
    return urls.slice(0, 8)
  }

  function isRejectedImageElement(image) {
    if (!image) return true
    const marker = [
      image.getAttribute('class'),
      image.getAttribute('id'),
      image.getAttribute('alt'),
      image.getAttribute('role'),
    ].filter(Boolean).join(' ')
    const tiny = image.naturalWidth > 0
      && image.naturalHeight > 0
      && image.naturalWidth < 64
      && image.naturalHeight < 64
    return tiny && /(?:avatar|logo|icon|emoji|sprite|favicon|profile|badge|placeholder|default)/i
      .test(marker)
  }

  function isRejectedImageUrl(value) {
    try {
      const url = new URL(value, location.href)
      return url.hostname.toLowerCase() === 'cdn.dancf.com'
        && url.pathname.toLowerCase().startsWith('/fe-assets/')
    } catch {
      return false
    }
  }
})()

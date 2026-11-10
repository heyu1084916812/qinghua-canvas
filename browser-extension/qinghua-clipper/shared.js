/* global AbortController, clearTimeout, fetch, setTimeout, URL */
(function installClipperApi() {
  const DEFAULT_ENDPOINT = 'http://127.0.0.1:53684/clip'
  const MAX_PAGE_URL_LENGTH = 2048

  class ClipperError extends Error {
    constructor(message, status = 0, code = '') {
      super(message)
      this.name = 'ClipperError'
      this.status = status
      this.code = code
    }
  }

  function normalizeEndpoint(value) {
    try {
      const url = new URL(String(value).trim())
      if (
        url.protocol !== 'http:'
        || url.hostname !== '127.0.0.1'
        || url.port !== '53684'
      ) {
        return ''
      }
      url.pathname = '/clip'
      url.search = ''
      url.hash = ''
      return url.toString()
    } catch {
      return ''
    }
  }

  function normalizePageUrl(value) {
    const raw = String(value || '').trim()
    if (!raw || raw.length > MAX_PAGE_URL_LENGTH) return ''
    try {
      const url = new URL(raw)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
      return url.toString()
    } catch {
      return ''
    }
  }

  function cleanTitle(value, pageUrl) {
    const raw = String(value || '').replace(/\s+/g, ' ').trim()
    const fallback = (() => {
      try {
        return new URL(pageUrl).hostname
      } catch {
        return '当前网页'
      }
    })()
    return (raw || fallback).slice(0, 300)
  }

  async function request(url, options, timeoutMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, {
        ...options,
        cache: 'no-store',
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ClipperError('连接轻画超时，请确认桌面端已打开', 0, 'timeout')
      }
      throw new ClipperError('无法连接轻画桌面端', 0, 'offline')
    } finally {
      clearTimeout(timer)
    }
  }

  async function checkReceiver(endpoint) {
    const normalized = normalizeEndpoint(endpoint)
    if (!normalized) {
      throw new ClipperError('接收端地址必须是 127.0.0.1:53684', 0, 'endpoint')
    }
    const health = new URL(normalized)
    health.pathname = '/health'
    const response = await request(
      health.toString(),
      { method: 'GET', headers: { Accept: 'application/json' } },
      3_000,
    )
    if (!response.ok) {
      throw new ClipperError(
        `轻画接收端返回 HTTP ${response.status}`,
        response.status,
        'health',
      )
    }
    return true
  }

  async function clipPage(input) {
    const endpoint = normalizeEndpoint(input.endpoint)
    if (!endpoint) {
      throw new ClipperError('接收端地址无效', 0, 'endpoint')
    }
    const pageUrl = normalizePageUrl(input.url)
    if (!pageUrl) {
      throw new ClipperError('当前标签页不是可收藏的 HTTP/HTTPS 网页', 0, 'page')
    }
      const imageUrl = input.imageUrl
        ? normalizePageUrl(input.imageUrl)
        : ''
      if (input.imageUrl && !imageUrl) {
        throw new ClipperError('拖入的图片地址不是公开 HTTP/HTTPS 地址', 0, 'image')
      }
    const token = String(input.token || '').trim()
    if (!token) {
      throw new ClipperError('请先填写轻画显示的配对令牌', 0, 'not-paired')
    }
    const response = await request(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Qinghua-Clipper-Token': token,
        },
        body: JSON.stringify({
          url: pageUrl,
          title: cleanTitle(input.title, pageUrl),
          ...(imageUrl ? { imageUrl } : {}),
        }),
      },
      15_000,
    )
    const result = await response.json().catch(() => ({}))
    if (response.ok && result.ok === true) return result
    if (response.status === 401) {
      throw new ClipperError('配对令牌无效，请在轻画重新复制', 401, 'auth')
    }
    if (response.status === 404) {
      throw new ClipperError('接收端地址不是轻画 Clipper', 404, 'not-found')
    }
    if (response.status === 413) {
      throw new ClipperError('网页地址过长，轻画无法接收', 413, 'too-large')
    }
    throw new ClipperError(
      String(result.error || `轻画接收失败：HTTP ${response.status}`),
      response.status,
      'receive',
    )
  }

  function errorText(error) {
    if (error instanceof Error && error.message.trim()) return error.message
    return '操作失败，请稍后重试'
  }

  globalThis.QinghuaClipper = Object.freeze({
    DEFAULT_ENDPOINT,
    checkReceiver,
    clipPage,
    errorText,
    normalizeEndpoint,
    normalizePageUrl,
  })
})()

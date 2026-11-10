import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ClipperInstallCard,
  resolveClipperInstallSource,
} from './ClipperInstallCard'
import { ClipperPairing } from './ClipperPairing'

describe('ClipperPairing', () => {
  it('shows the local endpoint and token copy actions when the receiver runs', () => {
    const html = renderToStaticMarkup(createElement(ClipperPairing, {
      receiver: {
        running: true,
        endpoint: 'http://127.0.0.1:53684/clip',
        token: 'test-token',
      },
    }))

    expect(html).toContain('http://127.0.0.1:53684/clip')
    expect(html).toContain('test-token')
    expect(html).toContain('复制本机地址')
    expect(html).toContain('复制配对令牌')
    expect(html).toContain('浏览器扩展只向本机发送当前网页地址')
  })

  it('shows the start failure without a token copy action', () => {
    const html = renderToStaticMarkup(createElement(ClipperPairing, {
      receiver: {
        running: false,
        endpoint: 'http://127.0.0.1:53684/clip',
        token: '',
        error: '接收端口启动失败',
      },
    }))

    expect(html).toContain('接收端未启动')
    expect(html).toContain('接收端口启动失败')
    expect(html).not.toContain('复制配对令牌')
  })
})

describe('ClipperInstallCard', () => {
  it('resolves Edge and Chrome from their official HTTPS store hosts', () => {
    expect(resolveClipperInstallSource({
      edgeStoreUrl:
        'https://microsoftedge.microsoft.com/addons/detail/qinghua-clipper',
      chromeStoreUrl:
        'https://chromewebstore.google.com/detail/qinghua-clipper/qinghua',
    })).toEqual({
      kind: 'store',
      links: [
        {
          browser: 'edge',
          label: 'Edge',
          url: 'https://microsoftedge.microsoft.com/addons/detail/qinghua-clipper',
        },
        {
          browser: 'chrome',
          label: 'Chrome',
          url: 'https://chromewebstore.google.com/detail/qinghua-clipper/qinghua',
        },
      ],
    })
    expect(resolveClipperInstallSource({
      edgeStoreUrl: 'https://example.com/clipper',
      chromeStoreUrl: 'edge://extensions',
    })).toEqual({ kind: 'unconfigured' })
  })

  it('renders separate one-click actions for Edge and Chrome', () => {
    const html = renderToStaticMarkup(createElement(ClipperInstallCard, {
      source: {
        kind: 'store',
        links: [
          {
            browser: 'edge',
            label: 'Edge',
            url: 'https://microsoftedge.microsoft.com/addons/detail/qinghua-clipper',
          },
          {
            browser: 'chrome',
            label: 'Chrome',
            url: 'https://chromewebstore.google.com/detail/qinghua-clipper/qinghua',
          },
        ],
      },
      onOpen: vi.fn(async () => undefined),
      onPair: vi.fn(),
    }))

    expect(html).toContain('Edge 一键安装')
    expect(html).toContain('Chrome 一键安装')
    expect(html).toContain('已安装，连接')
    expect(html).toContain('data-clipper-install-mode="store"')
  })

  it('offers honest offline instructions before a store link is published', () => {
    const html = renderToStaticMarkup(createElement(ClipperInstallCard, {
      source: { kind: 'unconfigured' },
      onOpen: vi.fn(async () => undefined),
      onPair: vi.fn(),
    }))

    expect(html).toContain('安装说明')
    expect(html).toContain('当前构建未连接扩展商店')
    expect(html).not.toContain('Edge 一键安装')
  })
})

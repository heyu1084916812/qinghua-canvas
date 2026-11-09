import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
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

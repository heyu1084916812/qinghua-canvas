import { describe, expect, it, vi } from 'vitest'
import type { NetworkPort, NetworkRequest } from '../../../platform/ports'
import { downloadKitImage, fetchKitUrl } from './kitWebImport'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const HTML = '<html><head><title>T</title><meta name="theme-color" content="#ff6600"><link rel="icon" href="/f.png"></head><body><p>品牌介绍</p></body></html>'

function response(status: number, type: string, body: string | Uint8Array, finalUrl?: string) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  return {
    status,
    headers: { 'Content-Type': type },
    ...(finalUrl ? { finalUrl } : {}),
    text: async () => (typeof body === 'string' ? body : ''),
    json: async () => ({}),
    arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
  }
}

function network(handler: (req: NetworkRequest) => ReturnType<typeof response>) {
  const request = vi.fn(async (req: NetworkRequest) => handler(req))
  return { port: { request } as unknown as NetworkPort, request }
}

describe('kitWebImport', () => {
  it('拒绝内网与非 http 地址，不发请求', async () => {
    const { port, request } = network(() => response(200, 'text/html', HTML))
    await expect(fetchKitUrl(port, 'http://127.0.0.1/admin', new AbortController().signal)).rejects.toThrow('公开互联网')
    await expect(fetchKitUrl(port, 'file:///etc/passwd', new AbortController().signal)).rejects.toThrow()
    await expect(downloadKitImage(port, 'http://192.168.1.2/a.png', new AbortController().signal)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('图片直链返回字节；所有请求都带 publicOnly', async () => {
    const { port, request } = network(() => response(200, 'image/png', PNG, 'https://a.com/logo.png'))
    const result = await fetchKitUrl(port, 'https://a.com/x', new AbortController().signal)
    expect(result).toMatchObject({ kind: 'image', mime: 'image/png', name: 'logo.png' })
    expect(request.mock.calls[0]![0]).toMatchObject({ publicOnly: true, method: 'GET' })
  })

  it('网页返回候选、颜色与正文，相对地址按最终地址补全', async () => {
    const { port } = network(() => response(200, 'text/html; charset=utf-8', HTML, 'https://a.com/zh/'))
    const result = await fetchKitUrl(port, 'https://a.com', new AbortController().signal)
    expect(result.kind).toBe('page')
    if (result.kind !== 'page') return
    expect(result.via).toBe('direct')
    expect(result.page.candidates[0]).toMatchObject({ url: 'https://a.com/f.png', source: 'icon' })
    expect(result.page.colors[0]!.hex).toBe('#FF6600')
    expect(result.page.text).toContain('品牌介绍')
  })

  it('直读失败时走 Jina Reader HTML 模式兜底', async () => {
    const { port, request } = network((req) =>
      req.url.startsWith('https://r.jina.ai/') ? response(200, 'text/html', HTML) : response(403, 'text/html', ''),
    )
    const result = await fetchKitUrl(port, 'https://a.com/', new AbortController().signal)
    expect(result).toMatchObject({ kind: 'page', via: 'jina' })
    expect(request.mock.calls[1]![0]).toMatchObject({ url: 'https://r.jina.ai/https://a.com/', headers: { 'X-Return-Format': 'html' } })
  })

  it('两条路都失败时如实报两条原因', async () => {
    const { port } = network(() => response(500, 'text/html', ''))
    await expect(fetchKitUrl(port, 'https://a.com/', new AbortController().signal)).rejects.toThrow(/原网页返回 HTTP 500；Jina Reader 兜底也失败/)
  })

  it('下载候选图：非图片拒绝，缺 content-type 时按魔数识别', async () => {
    const html = network(() => response(200, 'text/html', HTML))
    await expect(downloadKitImage(html.port, 'https://a.com/x', new AbortController().signal)).rejects.toThrow('不是图片')
    const sniff = network(() => response(200, '', PNG))
    await expect(downloadKitImage(sniff.port, 'https://a.com/x.png', new AbortController().signal)).resolves.toMatchObject({ mime: 'image/png', name: 'x.png' })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { downloadResearchImageBytes } from './researchImageDownload'

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])
const response = (bytes: Uint8Array, status = 200) => ({
  status, headers: {}, text: async () => '', json: async <T,>() => ({}) as T, arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
})
function platformWith(request: (...args: unknown[]) => Promise<unknown>) {
  const saveFile = vi.fn(async () => {})
  return { platform: { network: { request, async *stream() {} }, files: { saveFile } } as never, saveFile }
}

describe('downloadResearchImageBytes（2026-11-14 调研图片下载走公开网络通道）', () => {
  it('拿到真图片字节 ⇒ 按实际格式命名落盘（URL 没扩展名也不写错成 .jpg 以外）', async () => {
    const request = vi.fn(async () => response(JPEG))
    const { platform, saveFile } = platformWith(request)
    expect(await downloadResearchImageBytes(platform, 'https://cdn.cosmos.so/abc?format=jpeg', 'Tea', new AbortController().signal)).toBe('saved')
    expect((request.mock.calls[0] as unknown[] | undefined)?.[0]).toMatchObject({ publicOnly: true, method: 'GET' })
    expect(saveFile).toHaveBeenCalledWith('Tea.jpg', expect.any(Blob))
  })

  it('通道失败关闭（纯浏览器）/ 非 2xx / 不是图片 ⇒ 返回 null，交给调用方退回 saveFromUrl', async () => {
    for (const request of [
      vi.fn(async () => { throw { kind: 'network', detail: 'blocked' } }),
      vi.fn(async () => response(JPEG, 403)),
      vi.fn(async () => response(new TextEncoder().encode('<html>hotlink</html>'))),
      vi.fn(async () => response(new Uint8Array())),
    ]) {
      const { platform, saveFile } = platformWith(request)
      expect(await downloadResearchImageBytes(platform, 'https://bpando.org/a.jpg', 'Tea', new AbortController().signal)).toBeNull()
      expect(saveFile).not.toHaveBeenCalled()
    }
  })

  it('取消 ⇒ 抛出，不落盘', async () => {
    const controller = new AbortController()
    const request = vi.fn(async () => { controller.abort(new DOMException('已取消', 'AbortError')); throw new Error('aborted') })
    const { platform, saveFile } = platformWith(request)
    await expect(downloadResearchImageBytes(platform, 'https://bpando.org/a.jpg', 'Tea', controller.signal)).rejects.toThrow('已取消')
    expect(saveFile).not.toHaveBeenCalled()
  })
})

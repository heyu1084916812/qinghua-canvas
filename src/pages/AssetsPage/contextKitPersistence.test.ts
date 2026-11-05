import { describe, expect, it, vi } from 'vitest'
import { persistContextKitImage } from './contextKitPersistence'

const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' })

describe('上下文套件图片持久化端口', () => {
  it('非图片、空字节和超大图片都在写入前拒绝', async () => {
    const put = vi.fn()
    const storage = { put } as never
    await expect(persistContextKitImage(new Blob(['x'], { type: 'text/plain' }), 'a.txt', 'logo', 'p1', storage)).rejects.toThrow('只支持图片文件')
    await expect(persistContextKitImage(new Blob([], { type: 'image/png' }), 'a.png', 'logo', 'p1', storage)).rejects.toThrow('没有内容')
    const huge = new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: 'image/png' })
    await expect(persistContextKitImage(huge, 'huge.png', 'logo', 'p1', storage)).rejects.toThrow('超过 20MB')
    expect(put).not.toHaveBeenCalled()
  })

  it('图片字节按同一 hash 写入 assets 并返回资源引用', async () => {
    const put = vi.fn(async () => undefined)
    const storage = { put } as never
    const resource = await persistContextKitImage(png, 'logo.png', 'logo', 'project-a', storage)
    expect(resource).toMatchObject({ role: 'logo', name: 'logo.png' })
    expect(resource.hash).toMatch(/^[a-f0-9]+$/)
    expect(put).toHaveBeenCalledWith('assets', expect.objectContaining({ id: resource.hash, projectId: 'project-a' }))
  })
})

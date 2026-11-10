import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ReferenceEmptyState } from './ReferenceEmptyState'

describe('ReferenceEmptyState', () => {
  it('shows four real reference entry points without fake kit content', () => {
    const html = renderToStaticMarkup(
      createElement(ReferenceEmptyState, {
        busy: false,
        onUpload: vi.fn(),
        onAddLink: vi.fn(async () => undefined),
        onAddAsset: vi.fn(async () => undefined),
        onLoadAssets: vi.fn(async () => []),
        onOpenSource: vi.fn(),
      }),
    )

    expect(html).toContain('data-reference-empty')
    expect(html).toContain('从参考素材开始')
    expect(html).toContain('在对话或画布中上传的文件会出现在这里。')
    expect(html).toContain('上传文件')
    expect(html).toContain('链接')
    expect(html).toContain('选择素材')
    expect(html).toContain('连接器')
    expect(html).not.toContain('data-my-assets-kit-folder')
  })
})

import { createElement, StrictMode } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error Vitest runs this structural check in Node; the web tsconfig omits Node globals.
import { readFileSync } from 'node:fs'
import { IconSpinner } from '../../toolbar/icons'
import { ResearchGalleryOverlay } from './ResearchGalleryOverlay'
import type { ConversationResearchItem } from './conversation'
import { useResearchGalleryActions } from './useResearchGalleryActions'

vi.mock('react-dom', () => ({
  createPortal: (children: unknown) => children,
}))

vi.mock('./ResearchGalleryOverlay.module.css', () => ({
  default: new Proxy({}, {
    get: (_target, key) => `css-${String(key)}`,
  }),
}))

vi.mock('./useResearchOverlay', () => ({
  useResearchOverlay: () => ({ left: 0, top: 0, right: 420, bottom: 0 }),
  containResearchTabFocus: () => false,
}))

const item = {
  id: 'behance:1',
  title: 'Poster reference',
  url: 'https://www.behance.net/gallery/1/poster',
  imageUrl: 'https://cdn.example.com/poster.jpg',
  source: 'tavily',
}

function mount(
  onAdd: (item: ConversationResearchItem) => Promise<{ ok: boolean; message: string }>,
) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(
      createElement(ResearchGalleryOverlay, {
        items: [item],
        onClose: vi.fn(),
        onAdd,
      }),
    )
  })
  return renderer
}

describe('ResearchGalleryOverlay actions', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { body: {} },
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        requestAnimationFrame: (callback: FrameRequestCallback) => {
          callback(0)
          return 1
        },
      },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows aria-busy and the shared spinner class, then clears both on failure', async () => {
    let resolveAdd!: (value: { ok: boolean; message: string }) => void
    const onAdd = vi.fn(() => new Promise<{ ok: boolean; message: string }>((resolve) => {
      resolveAdd = resolve
    }))
    const renderer = mount(onAdd)
    const addButton = renderer.root.findByProps({
      'data-agent-research-gallery-add': item.id,
    })

    act(() => addButton.props.onClick())
    const confirm = renderer.root.findByProps({
      role: 'dialog',
      'aria-label': '加入项目参考',
    })
    act(() => confirm.findAllByType('button')[0]!.props.onClick())

    const busyAddButton = renderer.root.findByProps({
      'data-agent-research-gallery-add': item.id,
    })
    expect(busyAddButton.props['aria-busy']).toBe(true)
    expect(busyAddButton.props['data-busy']).toBe('true')
    expect(busyAddButton.props.disabled).toBe(true)
    expect(renderer.root.findAllByType(IconSpinner).length).toBeGreaterThan(0)
    expect(
      renderer.root.findAllByType(IconSpinner)
        .every((spinner) => spinner.props.className === 'css-busySpinner'),
    ).toBe(true)

    await act(async () => {
      resolveAdd({ ok: false, message: '加入失败：网络超时' })
      await Promise.resolve()
    })

    const clearedAddButton = renderer.root.findByProps({
      'data-agent-research-gallery-add': item.id,
    })
    expect(clearedAddButton.props['aria-busy']).toBe(false)
    expect(clearedAddButton.props['data-busy']).toBe('false')
    expect(clearedAddButton.props.disabled).toBe(false)
    expect(renderer.root.findAllByProps({
      role: 'dialog',
      'aria-label': '加入项目参考',
    })).toHaveLength(0)
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain(
      '加入失败：网络超时',
    )
  })

  it('aborts the active callback when the overlay closes', () => {
    let signal: AbortSignal | undefined
    const onClose = vi.fn()
    const onSend = vi.fn((_item, nextSignal?: AbortSignal) => {
      signal = nextSignal
      return new Promise<{ ok: boolean; message: string }>(() => {})
    })
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        createElement(ResearchGalleryOverlay, {
          items: [item],
          onClose,
          onSendToChat: onSend,
        }),
      )
    })

    act(() => renderer.root.findByProps({
      'data-agent-research-gallery-send': item.id,
    }).props.onClick())
    expect(signal?.aborted).toBe(false)
    expect(renderer.root.findByProps({
      'data-agent-research-gallery-send': item.id,
    }).props['aria-busy']).toBe(true)
    expect(
      renderer.root.findAllByType(IconSpinner)
        .every((spinner) => spinner.props.className === 'css-busySpinner'),
    ).toBe(true)

    act(() => renderer.root.findByProps({
      'aria-label': '关闭图片搜索结果',
    }).props.onClick())

    expect(signal?.aborted).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clears download busy state after a rejected save', async () => {
    let rejectDownload!: (reason: Error) => void
    const onDownload = vi.fn(() => new Promise<{ ok: boolean; message: string }>(
      (_resolve, reject) => {
        rejectDownload = reject
      },
    ))
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        createElement(ResearchGalleryOverlay, {
          items: [item],
          onClose: vi.fn(),
          onDownload,
        }),
      )
    })

    act(() => renderer.root.findByProps({
      'data-agent-research-gallery-download': item.id,
    }).props.onClick())
    expect(renderer.root.findByProps({
      'data-agent-research-gallery-download': item.id,
    }).props['aria-busy']).toBe(true)

    await act(async () => {
      rejectDownload(new Error('网络被拦截'))
      await Promise.resolve()
    })

    const downloadButton = renderer.root.findByProps({
      'data-agent-research-gallery-download': item.id,
    })
    expect(downloadButton.props['aria-busy']).toBe(false)
    expect(downloadButton.props.disabled).toBe(false)
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain(
      '下载失败：网络被拦截',
    )
  })

  it('keeps the large preview inside the canvas surface', () => {
    const css = readFileSync(
      new URL('./ResearchGalleryOverlay.module.css', import.meta.url),
      'utf8',
    )
    const rule = (selector: string) =>
      css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

    expect(rule('.preview')).toMatch(/position:\s*absolute\s*;/)
    expect(rule('.preview')).toMatch(/overflow:\s*hidden\s*;/)
    expect(rule('.preview img')).toMatch(/max-width:\s*100%\s*;/)
    expect(rule('.preview img')).toMatch(/max-height:\s*calc\(100%\s*-\s*60px\)\s*;/)
    expect(rule('.previewBar')).toMatch(/max-width:\s*100%\s*;/)
    expect(css).not.toContain('92vw')
    expect(rule('.busySpinner')).toMatch(/animation:\s*research-gallery-spin\s+0\.8s\s+linear\s+infinite\s*;/)
    expect(css).toContain('@keyframes research-gallery-spin')
  })

  it('G-R3: masonry auto-fits ~200px columns from the overlay width and caps tile height', () => {
    const css = readFileSync(
      new URL('./ResearchGalleryOverlay.module.css', import.meta.url),
      'utf8',
    )
    const masonry = css.match(/\.masonry\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(masonry).toMatch(/columns:\s*auto\s+200px\s*;/)
    expect(css).not.toMatch(/columns:\s*[123]\s*;/)
    const img = css.match(/\.imageButton img\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(img).toMatch(/max-height:\s*360px\s*;/)
    expect(img).toMatch(/object-fit:\s*cover\s*;/)
  })

  it('clears busy after the StrictMode effect replay', async () => {
    let actions!: ReturnType<typeof useResearchGalleryActions>
    function Harness() {
      actions = useResearchGalleryActions()
      return null
    }
    act(() => {
      TestRenderer.create(
        createElement(
          StrictMode,
          null,
          createElement(Harness),
        ),
      )
    })

    await act(async () => {
      await actions.run(
        item,
        'add',
        async () => ({ ok: false, message: 'strict mode failure' }),
      )
    })

    expect(actions.busy).toBeNull()
    expect(actions.status).toContain('strict mode failure')
  })
})

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

const item2 = { ...item, id: 'behance:2', imageUrl: 'https://cdn.example.com/poster-2.jpg' }

function selectionOf(selectedKeys: string[] = [], sentKeys: string[] = []) {
  return {
    selectedKeys: new Set(selectedKeys),
    sentKeys: new Set(sentKeys),
    onToggle: vi.fn(),
    onStage: vi.fn(),
  }
}

function mount(props: Partial<Parameters<typeof ResearchGalleryOverlay>[0]> = {}) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(
      createElement(ResearchGalleryOverlay, {
        items: [item, item2],
        onClose: vi.fn(),
        ...props,
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

  it('G-R2: clicking an image toggles selection; no add confirm popover or send button', () => {
    const selection = selectionOf([item2.imageUrl])
    const renderer = mount({ selection, onAdd: vi.fn(), onDownload: vi.fn() })
    act(() => renderer.root.findByProps({
      'data-agent-research-gallery-toggle': item.id,
    }).props.onClick())
    expect(selection.onToggle).toHaveBeenCalledWith(item)
    const tiles = renderer.root.findAll((node) =>
      node.props['data-agent-research-gallery-image'] !== undefined && node.type === 'figure')
    expect(tiles.map((tile) => tile.props['data-selected'])).toEqual(['false', 'true'])
    expect(renderer.root.findByProps({ 'data-agent-research-gallery-check': item2.id })
      .props['data-checked']).toBe('true')
    expect(renderer.root.findByProps({ 'data-agent-research-gallery-toggle': item2.id })
      .props['aria-pressed']).toBe(true)
    // 选中不调任何保存动作，也没有确认弹窗 / 单独的发送按钮 / 平铺下载按钮
    expect(renderer.root.findAll((node) => node.props['data-agent-research-gallery-add'] !== undefined)).toHaveLength(0)
    expect(renderer.root.findAll((node) => node.props['data-agent-research-gallery-send'] !== undefined)).toHaveLength(0)
    expect(renderer.root.findAll((node) => node.props['data-agent-research-gallery-download'] !== undefined)).toHaveLength(0)
    expect(renderer.root.findAllByProps({ role: 'dialog', 'aria-label': '加入项目参考' })).toHaveLength(0)
    expect(renderer.root.findByProps({ 'data-agent-research-gallery-hint': true }).children.join(''))
      .toContain('已选 1 张')
  })

  it('G-R2: the magnifier opens the large preview and download lives inside it', async () => {
    const onDownload = vi.fn(async () => ({ ok: true, message: '图片已保存' }))
    const renderer = mount({ selection: selectionOf(), onDownload })
    act(() => renderer.root.findByProps({
      'data-agent-research-gallery-zoom': item.id,
    }).props.onClick())
    const preview = renderer.root.findByProps({ 'data-agent-research-gallery-preview': true })
    const download = preview.findByProps({ 'data-agent-research-gallery-preview-download': true })
    await act(async () => {
      download.props.onClick()
      await Promise.resolve()
    })
    expect(onDownload).toHaveBeenCalledWith(item, expect.anything())
  })

  it('G-R2: a sent image has no checkbox; hover offers send-to-chat and add-to-reference', async () => {
    const selection = selectionOf([], [item.imageUrl])
    let resolveAdd!: (value: { ok: boolean; message: string }) => void
    const onAdd = vi.fn(() => new Promise<{ ok: boolean; message: string }>((resolve) => {
      resolveAdd = resolve
    }))
    const renderer = mount({ selection, onAdd })
    expect(renderer.root.findAll((node) =>
      node.props['data-agent-research-gallery-check'] === item.id)).toHaveLength(0)
    expect(renderer.root.findByProps({ 'data-agent-research-gallery-toggle': item.id })
      .props.disabled).toBe(true)
    act(() => renderer.root.findByProps({ 'data-agent-research-gallery-stage': item.id }).props.onClick())
    expect(selection.onStage).toHaveBeenCalledWith(item)

    act(() => renderer.root.findByProps({ 'data-agent-research-gallery-add': item.id }).props.onClick())
    const busy = renderer.root.findByProps({ 'data-agent-research-gallery-add': item.id })
    expect(busy.props['aria-busy']).toBe(true)
    expect(busy.props.disabled).toBe(true)
    expect(renderer.root.findAllByType(IconSpinner)
      .every((spinner) => spinner.props.className === 'css-busySpinner')).toBe(true)
    await act(async () => {
      resolveAdd({ ok: false, message: '添加到参考失败：网络超时' })
      await Promise.resolve()
    })
    const cleared = renderer.root.findByProps({ 'data-agent-research-gallery-add': item.id })
    expect(cleared.props['aria-busy']).toBe(false)
    expect(cleared.props.disabled).toBe(false)
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('网络超时')
    // 未发送过的图仍是勾选框，没有悬停动作
    expect(renderer.root.findAll((node) =>
      node.props['data-agent-research-gallery-stage'] === item2.id)).toHaveLength(0)
  })

  it('aborts the active callback when the overlay closes', () => {
    let signal: AbortSignal | undefined
    const onClose = vi.fn()
    const onAdd = vi.fn((_item: ConversationResearchItem, nextSignal?: AbortSignal) => {
      signal = nextSignal
      return new Promise<{ ok: boolean; message: string }>(() => {})
    })
    const renderer = mount({ onClose, onAdd, selection: selectionOf([], [item.imageUrl]) })
    act(() => renderer.root.findByProps({ 'data-agent-research-gallery-add': item.id }).props.onClick())
    expect(signal?.aborted).toBe(false)
    act(() => renderer.root.findByProps({
      'aria-label': '关闭图片搜索结果',
    }).props.onClick())
    expect(signal?.aborted).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
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

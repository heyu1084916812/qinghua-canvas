import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  openResearchSource,
  RESEARCH_SOURCE_PREVIEW_ROWS,
  ResearchSourceRow,
  type ResearchSourceOpenEnvironment,
} from './ResearchSourcesDrawer'
import type { ConversationResearchItem } from './conversation'

const item: ConversationResearchItem = {
  id: 'behance:1',
  title: 'Poster reference',
  url: 'https://www.behance.net/gallery/1/poster',
  imageUrl: '',
  source: 'tavily',
}

function environment(
  overrides: Partial<ResearchSourceOpenEnvironment> = {},
): ResearchSourceOpenEnvironment {
  return {
    desktop: false,
    openWithDesktop: vi.fn(async () => {}),
    openWithBrowser: vi.fn(() => ({}) as Window),
    ...overrides,
  }
}

describe('ResearchSourcesDrawer', () => {
  it('keeps a native anchor and only intercepts it on desktop', () => {
    const onOpen = vi.fn()
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        createElement(ResearchSourceRow, {
          item,
          desktop: true,
          onOpen,
        }),
      )
    })

    const anchor = renderer.root.findByType('a')
    expect(anchor.props.href).toBe(item.url)
    expect(anchor.props.target).toBe('_blank')
    expect(anchor.props.rel).toContain('noreferrer')

    const desktopEvent = { preventDefault: vi.fn() }
    act(() => anchor.props.onClick(desktopEvent))
    expect(desktopEvent.preventDefault).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledWith(item.url)

    act(() => {
      renderer.update(
        createElement(ResearchSourceRow, {
          item,
          desktop: false,
          onOpen,
        }),
      )
    })
    const browserEvent = { preventDefault: vi.fn() }
    act(() => renderer.root.findByType('a').props.onClick(browserEvent))
    expect(browserEvent.preventDefault).not.toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('opens through the desktop opener without opening a browser popup', async () => {
    const env = environment({ desktop: true })
    await expect(openResearchSource(item.url, env)).resolves.toEqual({ ok: true })
    expect(env.openWithDesktop).toHaveBeenCalledWith(item.url)
    expect(env.openWithBrowser).not.toHaveBeenCalled()
  })

  it('returns a typed desktop failure and preserves the original cause', async () => {
    const cause = new Error('opener scope denied')
    const env = environment({
      desktop: true,
      openWithDesktop: vi.fn(async () => {
        throw cause
      }),
    })

    await expect(openResearchSource(item.url, env)).resolves.toEqual({
      ok: false,
      reason: 'desktop-open-failed',
      message: '系统默认浏览器没有成功打开这个链接，请稍后重试',
      cause,
    })
    expect(env.openWithBrowser).not.toHaveBeenCalled()
  })

  it('reports browser popup blocking and unexpected browser errors', async () => {
    await expect(
      openResearchSource(
        item.url,
        environment({ openWithBrowser: vi.fn(() => null) }),
      ),
    ).resolves.toEqual({
      ok: false,
      reason: 'popup-blocked',
      message: '浏览器阻止了新窗口，请允许弹窗后重试',
    })

    const cause = new Error('window.open failed')
    await expect(
      openResearchSource(
        item.url,
        environment({
          openWithBrowser: vi.fn(() => {
            throw cause
          }),
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      reason: 'browser-open-failed',
      message: '浏览器没有成功打开这个链接，请稍后重试',
      cause,
    })
  })

  it('keeps the six-source compact viewport explicit', () => {
    expect(RESEARCH_SOURCE_PREVIEW_ROWS).toBe(6)
  })
})

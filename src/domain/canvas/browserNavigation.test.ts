import { describe, expect, it } from 'vitest'
import {
  browserNavReducer,
  canGoBack,
  canGoForward,
  currentBrowserUrl,
  INITIAL_BROWSER_NAV,
  type BrowserNavAction,
  type BrowserNavState,
} from './browserNavigation'

const run = (actions: BrowserNavAction[], from: BrowserNavState = INITIAL_BROWSER_NAV) =>
  actions.reduce(browserNavReducer, from)

describe('browserNavReducer', () => {
  it('starts blank with no history', () => {
    expect(INITIAL_BROWSER_NAV.phase).toBe('blank')
    expect(canGoBack(INITIAL_BROWSER_NAV)).toBe(false)
    expect(canGoForward(INITIAL_BROWSER_NAV)).toBe(false)
  })

  it('go pushes, back/forward move the pointer and bump the revision', () => {
    const s = run([
      { type: 'go', url: 'https://a.com/' },
      { type: 'loaded' },
      { type: 'go', url: 'https://b.com/' },
      { type: 'loaded' },
    ])
    expect(s.entries).toEqual(['https://a.com/', 'https://b.com/'])
    expect(canGoBack(s)).toBe(true)
    const back = browserNavReducer(s, { type: 'back' })
    expect(currentBrowserUrl(back)).toBe('https://a.com/')
    expect(back.phase).toBe('loading')
    expect(back.revision).toBe(s.revision + 1)
    expect(canGoForward(back)).toBe(true)
    const fwd = browserNavReducer(back, { type: 'forward' })
    expect(currentBrowserUrl(fwd)).toBe('https://b.com/')
  })

  it('go after back truncates forward history', () => {
    const s = run([
      { type: 'go', url: 'https://a.com/' },
      { type: 'go', url: 'https://b.com/' },
      { type: 'back' },
      { type: 'go', url: 'https://c.com/' },
    ])
    expect(s.entries).toEqual(['https://a.com/', 'https://c.com/'])
    expect(canGoForward(s)).toBe(false)
  })

  it('first commit after a user navigation replaces the entry (redirects)', () => {
    const s = run([
      { type: 'go', url: 'https://a.com/' },
      { type: 'committed', url: 'https://www.a.com/' },
    ])
    expect(s.entries).toEqual(['https://www.a.com/'])
    const link = browserNavReducer({ ...s, phase: 'loaded' }, { type: 'committed', url: 'https://www.a.com/p/1' })
    expect(link.entries).toEqual(['https://www.a.com/', 'https://www.a.com/p/1'])
    expect(link.index).toBe(1)
  })

  it('commit equal to the current entry after back does not push', () => {
    const s = run([
      { type: 'go', url: 'https://a.com/' },
      { type: 'loaded' },
      { type: 'go', url: 'https://b.com/' },
      { type: 'loaded' },
      { type: 'back' },
      { type: 'committed', url: 'https://a.com/' },
      { type: 'loaded', url: 'https://a.com/' },
    ])
    expect(s.entries).toEqual(['https://a.com/', 'https://b.com/'])
    expect(s.index).toBe(0)
    expect(s.phase).toBe('loaded')
  })

  it('stop ends loading; reload restarts it; failed shows the error', () => {
    const loading = run([{ type: 'go', url: 'https://a.com/' }])
    expect(browserNavReducer(loading, { type: 'stop' }).phase).toBe('loaded')
    const failed = browserNavReducer(loading, { type: 'failed', message: 'x' })
    expect(failed.phase).toBe('error')
    expect(failed.error).toBe('x')
    expect(browserNavReducer(failed, { type: 'loaded' }).phase).toBe('error')
    const retry = browserNavReducer(failed, { type: 'reload' })
    expect(retry.phase).toBe('loading')
    expect(retry.error).toBe('')
  })

  it('title is kept until the next navigation; home resets to the start page', () => {
    const s = run([{ type: 'go', url: 'https://a.com/' }, { type: 'title', title: 'A' }])
    expect(s.title).toBe('A')
    expect(browserNavReducer(s, { type: 'go', url: 'https://b.com/' }).title).toBe('')
    expect(browserNavReducer(s, { type: 'home' }).phase).toBe('blank')
  })
})

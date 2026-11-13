import { afterEach, describe, expect, it } from 'vitest'
import {
  answerBrowserWall,
  BROWSER_WALL_HEADLINE,
  browserWallDetail,
  browserWallStore,
  requestBrowserWall,
} from './agentBrowserWall'

const REQUEST = { siteId: 'pinterest' as const, label: 'Pinterest', kind: 'login' as const, reason: '需要登录', url: 'https://www.pinterest.com/search/pins/?q=tea' }

afterEach(() => browserWallStore.reset())

describe('Agent 浏览器「需要你处理」待办', () => {
  it('挂上待办 → 界面看到 → 点继续后撤掉并把回答交回调研', async () => {
    let notified = 0
    const off = browserWallStore.subscribe(() => { notified += 1 })
    const pending = requestBrowserWall(REQUEST, new AbortController().signal)
    const [prompt] = browserWallStore.get()
    expect(prompt).toMatchObject(REQUEST)
    answerBrowserWall(prompt!.key, 'continue')
    await expect(pending).resolves.toBe('continue')
    expect(browserWallStore.get()).toEqual([])
    expect(notified).toBe(2)
    off()
  })

  it('调研被停止：待办自动撤掉，按取消处理', async () => {
    const controller = new AbortController()
    const pending = requestBrowserWall(REQUEST, controller.signal)
    expect(browserWallStore.get()).toHaveLength(1)
    controller.abort()
    await expect(pending).resolves.toBe('cancel')
    expect(browserWallStore.get()).toEqual([])
  })

  it('已中止的信号直接取消；重复回答无害', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(requestBrowserWall(REQUEST, controller.signal)).resolves.toBe('cancel')
    expect(browserWallStore.get()).toEqual([])
    answerBrowserWall('wall-404', 'continue')
  })

  it('文案：固定标题 + 站点与下一步', () => {
    expect(BROWSER_WALL_HEADLINE).toBe('需要你处理一下验证/登录，完成后点继续')
    expect(browserWallDetail(REQUEST)).toContain('Pinterest 需要登录')
    expect(browserWallDetail({ ...REQUEST, kind: 'challenge', reason: '弹出了人机验证' })).toContain('验证完成后')
  })
})

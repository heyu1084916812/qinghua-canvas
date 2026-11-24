import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  canvasLogRecordsOf,
  formatLogTime,
  isLogBackdropPointerDown,
  openLogThumbnail,
  routeAttemptSummary,
  shouldShowInCanvasLog,
  statusLabel,
} from './LogPanel'

/**
 * 日志面板的纯展示逻辑（产品文档 §6.18）：
 * 上排胶囊状态文案与时间格式——这两项是记录排版里唯一的确定性映射，单独抽出便于单测。
 */
describe('LogPanel / 展示逻辑', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('状态徽标：成功 / 失败 / 已取消 / 已中断', () => {
    expect(statusLabel('succeeded')).toBe('成功')
    expect(statusLabel('failed')).toBe('失败')
    expect(statusLabel('canceled')).toBe('已取消')
    expect(statusLabel('interrupted')).toBe('已中断')
  })

  it('时间格式为 YYYY/MM/DD HH:mm:ss', () => {
    const ts = new Date(2026, 7, 28, 8, 52, 15).getTime() // 2026-08-28 08:52:15
    expect(formatLogTime(ts)).toBe('2026/08/28 08:52:15')
  })

  it('个位数月 / 日 / 时补零', () => {
    const ts = new Date(2026, 0, 5, 3, 4, 9).getTime()
    expect(formatLogTime(ts)).toBe('2026/01/05 03:04:09')
  })

  it('只有点到遮罩本身才关闭，面板内部事件不能误关', () => {
    const backdrop = new EventTarget()
    const panelChild = new EventTarget()
    expect(isLogBackdropPointerDown(backdrop, backdrop)).toBe(true)
    expect(isLogBackdropPointerDown(panelChild, backdrop)).toBe(false)
    expect(isLogBackdropPointerDown(null, backdrop)).toBe(false)
  })

  it('只有发生换组时才显示路由次数，并在悬停说明里保留每次结果', () => {
    expect(routeAttemptSummary(undefined)).toBeNull()
    expect(routeAttemptSummary([{
      attempt: 1,
      channelId: 'relay',
      requestedModel: 'GPT Image',
      sentModel: 'gpt-image',
      status: 'succeeded',
      startedAt: 0,
      finishedAt: 0,
      durationMs: 0,
    }])).toBeNull()

    const summary = routeAttemptSummary([
      {
        attempt: 1,
        channelId: 'relay',
        credentialGroupId: 'primary',
        requestedModel: 'GPT Image',
        sentModel: 'gpt-image',
        status: 'failed',
        errorText: 'HTTP 403',
        startedAt: 0,
        finishedAt: 0,
        durationMs: 0,
      },
      {
        attempt: 2,
        channelId: 'relay',
        credentialGroupId: 'backup',
        requestedModel: 'GPT Image',
        sentModel: 'gpt-image',
        status: 'succeeded',
        startedAt: 0,
        finishedAt: 0,
        durationMs: 0,
      },
    ])
    expect(summary?.count).toBe(2)
    expect(summary?.title).toContain('primary')
    expect(summary?.title).toContain('HTTP 403')
    expect(summary?.title).toContain('backup')
  })

  it('画布日志过滤对话模型调用，只保留生成与本地合成', () => {
    const text = { id: 'text', params: { kind: 'text', model: 'Deepseek' } }
    const image = { id: 'image', params: { mode: 'image', model: 'GPT Image 2' } }
    const unknown = { id: 'unknown', params: {} }
    expect(shouldShowInCanvasLog(text)).toBe(false)
    expect(shouldShowInCanvasLog(image)).toBe(true)
    expect(shouldShowInCanvasLog(unknown)).toBe(true)
    expect(
      canvasLogRecordsOf([text, image, unknown] as never).map((record) => record.id),
    ).toEqual(['image', 'unknown'])
  })

  it('日志缩略图打开灯箱时携带按钮内真实图片的 FLIP 快照', () => {
    vi.stubGlobal('getComputedStyle', () => ({ borderRadius: '8px' }))
    const image = {
      tagName: 'IMG',
      currentSrc: 'blob:log',
      src: 'blob:log',
      getAttribute: () => null,
      getBoundingClientRect: () => ({
        left: 12,
        top: 34,
        width: 96,
        height: 72,
        right: 108,
        bottom: 106,
        x: 12,
        y: 34,
        toJSON: () => ({}),
      }),
    } as unknown as HTMLImageElement
    const host = {
      matches: () => false,
      querySelector: () => image,
    } as unknown as HTMLElement
    const openLightbox = vi.fn()

    openLogThumbnail({ openLightbox }, 'hash-log', host)

    expect(openLightbox).toHaveBeenCalledWith('hash-log', {
      sourceRect: {
        left: 12,
        top: 34,
        width: 96,
        height: 72,
        borderRadius: '8px',
        src: 'blob:log',
        kind: 'image',
        assetHash: 'hash-log',
      },
    })
  })
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentActivityStrip,
  AgentGenerationTasks,
  TypewriterActivity,
  activityTextOf,
  statusCanSteer,
  statusIsBusy,
} from './AgentActivityViews'

describe('AgentActivityViews', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('保留状态忙闲判断与生成中文案', () => {
    expect(statusIsBusy({ kind: 'thinking' })).toBe(true)
    expect(statusIsBusy({ kind: 'idle' })).toBe(false)
    expect(statusCanSteer({ kind: 'toolRunning' })).toBe(true)
    expect(statusCanSteer({ kind: 'paused', message: '' })).toBe(false)
    expect(
      activityTextOf({ kind: 'executing', tool: 'runNode' }, 2, [], []),
    ).toBe('生成任务正在推进')
  })

  it('生成任务展示保留原 DOM 锚点与文案', () => {
    const html = renderToStaticMarkup(
      createElement(AgentGenerationTasks, {
        tasks: [
          {
            nodeId: 'node-1',
            title: '主图',
            status: 'done',
            startedAt: 1_000,
            finishedAt: 3_000,
          },
        ],
      }),
    )

    expect(html).toContain('data-agent-run-task-count="1"')
    expect(html).toContain('data-agent-run-task-node="node-1"')
    expect(html).toContain('data-agent-run-task-status="done"')
    expect(html).toContain('生成完成 1/1')
    expect(html).toContain('主图')
    expect(html).toContain('已完成')
  })

  it('非实时打字态保留可访问全文与过程锚点', () => {
    const html = renderToStaticMarkup(
      createElement(TypewriterActivity, {
        text: '正在检查画面',
        live: false,
        textKey: 'process-1',
        current: true,
      }),
    )

    expect(html).toContain('data-agent-process-text')
    expect(html).toContain('data-agent-process-current')
    expect(html).toContain('正在检查画面')
    expect(html).toContain('aria-live="polite"')
  })

  it('活动条保留状态、展开入口和过程锚点', () => {
    const html = renderToStaticMarkup(
      createElement(AgentActivityStrip, {
        status: { kind: 'executing', tool: 'runNode' },
        items: [],
        activities: [],
        history: [],
        processText: '正在生成主图',
        live: false,
      }),
    )

    expect(html).toContain('data-agent-activity')
    expect(html).toContain('data-agent-status="executing"')
    expect(html).toContain('data-agent-process-current')
    expect(html).toContain('data-agent-activity-toggle')
    expect(html).toContain('正在生成主图')
  })

  it('★★ 已完成阶段折叠时只显示事实摘要，不重复展开同一阶段正文', () => {
    const html = renderToStaticMarkup(
      createElement(AgentActivityStrip, {
        status: { kind: 'idle' },
        items: [],
        activities: [],
        history: [
          { id: 'intent', text: '先核对参考图。', source: 'intent', createdAt: 1 },
          {
            id: 'phase-ref',
            text: '按当前任务匹配到 3 张参考。',
            phase: 'referenceAnalysis',
            collapsedSummary: '参考分析完成 · 3 项依据',
            createdAt: 2,
          },
        ],
        processText: '',
        startedAt: 1,
        finishedAt: 3,
        live: false,
      }),
    )

    expect(html).toContain('参考分析完成 · 3 项依据')
    expect(html).not.toContain('先核对参考图。参考分析完成')
    expect(html).toContain('data-agent-activity-toggle')
  })

  it('★★ 最终消息 reveal 期间，整块过程文本继续打字而不是一次性铺满', () => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
      setInterval,
      clearInterval,
    })
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        createElement(AgentActivityStrip, {
          status: { kind: 'idle' },
          items: [],
          activities: [],
          history: [
            {
              id: 'reasoning-1',
              source: 'reasoning',
              text: '这是一段需要逐字展示的过程内容。',
              createdAt: 1,
            },
          ],
          processText: '',
          live: false,
          revealing: true,
        }),
      )
    })

    const current = renderer.root
      .findAllByType(TypewriterActivity)
      .find((node) => node.props.current === true)
    expect(current?.props.live).toBe(true)
    expect(current?.props.text).toContain('这是一段需要逐字展示')
    act(() => renderer.unmount())
  })
})

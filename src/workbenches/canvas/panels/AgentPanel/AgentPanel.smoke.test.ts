import { createElement, type ReactElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformProvider } from '../../../../app/providers/PlatformProvider'
import { ChannelStoreProvider } from '../../../../app/providers/ChannelStoreProvider'
import { createMemoryPlatform } from '../../../../platform/memory'
import type { PlatformKit } from '../../../../platform/ports'
import { createAgentSessionStore } from '../../../../state/agent/sessionStore'
import { createCanvasStore } from '../../../../state/workbenches/canvas/store'
import {
  CanvasExecutionValueProvider,
  type CanvasExecutionApi,
} from '../../execution/CanvasExecutionProvider'
import { CanvasStoreProvider } from '../../storeContext'
import { AgentPanel } from './AgentPanel'

/**
 * **面板能不能装起来**（渲染冒烟）。
 *
 * 这个文件不验证任何业务行为（那是 30 个控制器各自测试的事），它只钉三条底线：
 * 1. `AgentPanel` 在**最小 provider 栈**下能挂载，且不产生 React 警告；
 * 2. 关键 `data-agent-*` 锚点真的渲染出来了（头部 / 对话区 / 输入区）；
 * 3. **无会话**与**有会话但空消息**两种初始状态都不炸。
 *
 * 覆盖率的额外收益：三个装配 hook（session / tool / turn model）此前 0%，它们的分支
 * 绝大多数是渲染期的 `current?.x ?? 兜底`——把这两条路径跑一遍，等于顺手验完那批兜底。
 *
 * 装配全部复用现成的真实现（`createMemoryPlatform` + `createCanvasStore`），
 * 只有执行层 API 用一个空对象顶替（`CanvasExecutionValueProvider` 的注释写明
 * "只注入既有 API 值"；渲染期它一个成员都不会被调用）。
 */

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function treeOf(platform: PlatformKit, projectId: string): ReactElement {
  const store = createCanvasStore({ platform, projectId })
  /*
   * React 19 的类型里 `children` 是**必填 prop**，不能用 createElement 的第三参凑：
   * 先把子组件建好，再作为 prop 传进去。TS 只报这两个 provider（其余声明的 children 可选）。
   */
  const execution = createElement(CanvasExecutionValueProvider, {
    value: {} as unknown as CanvasExecutionApi,
    children: createElement(AgentPanel, {
      projectId,
      onClose: () => {},
      onOpenSettings: () => {},
    }),
  })
  return createElement(
    // 技能控制器里有 useNavigate()（"打开技能库"跳路由），所以需要一层 Router
    MemoryRouter,
    { initialEntries: ['/canvas/p1'] },
    createElement(
      PlatformProvider,
      { create: () => platform },
      createElement(
        ChannelStoreProvider,
        null,
        createElement(CanvasStoreProvider, { store, children: execution }),
      ),
    ),
  )
}

async function renderPanel(
  platform: PlatformKit,
  projectId = 'p1',
): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(treeOf(platform, projectId))
  })
  // 初始加载是 effect 里的异步（列会话 / 读投递模式），放一拍让它落定
  await act(async () => {
    await Promise.resolve()
  })
  return renderer
}

const anchorsOf = (renderer: TestRenderer.ReactTestRenderer): string =>
  JSON.stringify(renderer.toJSON())

beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal(
    'window',
    Object.assign(Object.create(Object.prototype), {
      matchMedia: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })),
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      innerWidth: 1440,
      innerHeight: 900,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    }),
  )
  vi.stubGlobal('document', {
    documentElement: { dataset: {} as Record<string, string> },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    querySelector: () => null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AgentPanel 渲染冒烟', () => {
  it('★ 无会话时能挂载，无 React 警告，关键锚点齐全', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const renderer = await renderPanel(createMemoryPlatform())

    const json = anchorsOf(renderer)
    expect(json).toContain('data-agent-panel')
    expect(json).toContain('data-agent-header')
    expect(json).toContain('data-agent-send-idle')
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
    act(() => renderer.unmount())
  })

  it('★ 有会话但消息为空时渲染正常', async () => {
    const platform = createMemoryPlatform()
    // 先用同一份 storage 建一条空消息会话（初始加载会把它带成 current）
    await createAgentSessionStore(platform.storage).create({
      projectId: 'p1',
      channelId: '',
      model: 'GPT-6 Astra',
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const renderer = await renderPanel(platform)

    const json = anchorsOf(renderer)
    expect(json).toContain('data-agent-panel')
    expect(json).toContain('data-agent-messages')
    expect(json).toContain('data-agent-composer')
    expect(json).toContain('data-agent-session-count')
    expect(json).not.toContain('data-agent-status-line')
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
    act(() => renderer.unmount())
  })
})

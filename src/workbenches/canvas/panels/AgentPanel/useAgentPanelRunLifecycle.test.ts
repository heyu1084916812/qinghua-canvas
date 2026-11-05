import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { TaskLifecycleClosedError } from '../../../../features/shared/lifecycle/taskLifecycle'
import type { NoticeTone } from '../../../../domain/ui/notice'
import {
  useAgentPanelRunLifecycle,
  type AgentPanelRunLifecycle,
} from './useAgentPanelRunLifecycle'

function renderLifecycle(
  notify: (text: string, tone?: NoticeTone) => void,
) {
  let current!: AgentPanelRunLifecycle
  function Probe() {
    current = useAgentPanelRunLifecycle({ notify })
    return null
  }
  let root!: TestRenderer.ReactTestRenderer
  act(() => {
    root = TestRenderer.create(createElement(Probe))
  })
  return {
    get: () => current,
    unmount: () => act(() => root.unmount()),
  }
}

describe('useAgentPanelRunLifecycle', () => {
  it('普通异步失败只提示一次，成功任务不提示', async () => {
    const notify = vi.fn<(text: string, tone?: NoticeTone) => void>()
    const hook = renderLifecycle(notify)

    hook.get().runPromiseDetached(Promise.resolve('ok'), '保存失败')
    await Promise.resolve()
    expect(notify).not.toHaveBeenCalled()

    hook.get().runPromiseDetached(Promise.reject(new Error('磁盘满')), '保存失败')
    await Promise.resolve()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('保存失败：磁盘满', 'error')
  })

  it('面板已经关闭时静默，不把生命周期关闭错误弹给用户', async () => {
    const notify = vi.fn<(text: string, tone?: NoticeTone) => void>()
    const hook = renderLifecycle(notify)

    hook.get().runPromiseDetached(
      Promise.reject(new TaskLifecycleClosedError()),
      '保存失败',
    )
    await Promise.resolve()
    expect(notify).not.toHaveBeenCalled()
  })

  it('trackRun 与 runSync 仍走同一个生命周期', async () => {
    const notify = vi.fn<(text: string, tone?: NoticeTone) => void>()
    const hook = renderLifecycle(notify)

    await expect(hook.get().trackRun(async () => 7)).resolves.toBe(7)
    expect(hook.get().runSync(() => 'sync')).toBe('sync')
    expect(notify).not.toHaveBeenCalled()
  })
})

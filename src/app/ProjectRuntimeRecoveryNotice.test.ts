import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ProjectRuntimeCleanupError,
  ProjectRuntimeRecoveryError,
  getProjectRuntimePendingSnapshot,
  registerProjectRuntime,
  resetProjectRuntimesForTests,
  withPreparedProjectRuntimes,
} from './ProjectRuntimeRegistry'
import { ProjectRuntimeRecoveryNotice } from './ProjectRuntimeRecoveryNotice'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  resetProjectRuntimesForTests()
})

describe('ProjectRuntimeRecoveryNotice', () => {
  it('页面卸载后全局入口仍存在，重试成功后自动清除', async () => {
    let ready = false
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => ({
        waitForIdle: async () => undefined,
        whenIdle: async () => undefined,
        canReopen: () => ready,
        reopenIfIdle: () => ready,
        canFinalize: () => true,
        finalize: () => ready,
      }),
    })
    await expect(
      withPreparedProjectRuntimes(['p1'], async () => 'deleted'),
    ).rejects.toBeInstanceOf(ProjectRuntimeCleanupError)
    expect(getProjectRuntimePendingSnapshot()).toHaveLength(1)

    let page!: TestRenderer.ReactTestRenderer
    act(() => {
      page = TestRenderer.create(
        createElement('main', null, '项目页'),
      )
    })
    let notice!: TestRenderer.ReactTestRenderer
    act(() => {
      notice = TestRenderer.create(
        createElement(ProjectRuntimeRecoveryNotice),
      )
    })
    expect(
      notice.root.findAll(
        (node) =>
          node.props['data-project-runtime-recovery-notice'] !==
          undefined,
      ),
    ).toHaveLength(1)
    expect(
      notice.root.find(
        (node) =>
          node.props['data-project-runtime-work-committed'] !==
          undefined,
      ).props['data-project-runtime-work-committed'],
    ).toBe('true')

    act(() => page.unmount())
    expect(getProjectRuntimePendingSnapshot()).toHaveLength(1)
    expect(
      notice.root.findAll(
        (node) =>
          node.props['data-project-runtime-recovery-notice'] !==
          undefined,
      ),
    ).toHaveLength(1)

    ready = true
    await act(async () => {
      await notice.root.find(
        (node) =>
          node.type === 'button' &&
          String(node.props['data-project-runtime-retry'] ?? '')
            .length > 0,
      ).props.onClick()
    })

    expect(getProjectRuntimePendingSnapshot()).toEqual([])
    expect(
      notice.root.findAll(
        (node) =>
          node.props['data-project-runtime-recovery-notice'] !==
          undefined,
      ),
    ).toHaveLength(0)

    act(() => notice.unmount())
  })

  it('work 未提交的恢复失败显示为待恢复，并可从全局入口重试', async () => {
    let idle = false
    registerProjectRuntime({
      projectId: 'p2',
      key: 'canvas-agent',
      beginDispose: () => ({
        waitForIdle: async () => {
          throw new Error('initial idle failed')
        },
        whenIdle: () =>
          idle
            ? Promise.resolve()
            : new Promise<void>(() => undefined),
        canReopen: () => idle,
        reopenIfIdle: () => idle,
        canFinalize: () => idle,
        finalize: () => idle,
      }),
    })
    await expect(
      withPreparedProjectRuntimes(['p2'], async () => 'unreachable', {
        shutdownTimeoutMs: 5,
      }),
    ).rejects.toBeInstanceOf(ProjectRuntimeRecoveryError)
    for (let i = 0; i < 20; i += 1) {
      if (
        getProjectRuntimePendingSnapshot()[0]?.status ===
        'recovery_failed'
      ) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    let notice!: TestRenderer.ReactTestRenderer
    act(() => {
      notice = TestRenderer.create(
        createElement(ProjectRuntimeRecoveryNotice),
      )
    })
    const pending = notice.root.find(
      (node) =>
        node.props['data-project-runtime-work-committed'] !==
        undefined,
    )
    expect(
      pending.props['data-project-runtime-work-committed'],
    ).toBe('false')
    expect(
      notice.root.find(
        (node) =>
          node.props['data-project-runtime-pending'] !== undefined,
      ).children.length,
    ).toBeGreaterThan(0)

    idle = true
    await act(async () => {
      await notice.root.find(
        (node) =>
          node.type === 'button' &&
          node.props['data-project-runtime-retry'] !== undefined,
      ).props.onClick()
    })
    expect(getProjectRuntimePendingSnapshot()).toEqual([])
    act(() => notice.unmount())
  })
})

import { createElement } from 'react'
import {
  MemoryRouter,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearAgentHandoff, sendSelectionToAgent, takeAgentHandoff } from '../features/canvas/agentHandoff'
import { clearAgentSkillHandoff, sendSkillToAgent, subscribeAgentSkillHandoff, takeAgentSkillHandoff } from '../features/canvas/agentSkillHandoff'
import { activeCanvasId, forgetActiveCanvas, rememberActiveCanvas } from '../state/project/activeCanvas'
import {
  clearDeletedProjectState,
  isCanvasProjectPath,
  leaveDeletedCanvasRoute,
} from './deletedProjectState'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  forgetActiveCanvas()
  clearAgentHandoff('p1')
  clearAgentSkillHandoff('p1')
})

describe('deletedProjectState', () => {
  it('删除成功后清活动画布与两类 handoff', () => {
    rememberActiveCanvas('p1')
    sendSelectionToAgent('p1', ['node-1'])
    sendSkillToAgent('p1', 'skill-1')

    clearDeletedProjectState('p1')

    expect(activeCanvasId()).toBeNull()
    expect(takeAgentHandoff('p1')).toEqual([])
    expect(takeAgentSkillHandoff('p1')).toBeNull()
  })

  it('只把当前画布自身的路径判为需要离场', () => {
    expect(isCanvasProjectPath('/canvas/p1', 'p1')).toBe(true)
    expect(isCanvasProjectPath('/canvas/p2', 'p1')).toBe(false)
    expect(isCanvasProjectPath('/settings', 'p1')).toBe(false)
  })

  it('当前画布删除成功后由路由导航离开原路径', () => {
    function Probe() {
      const navigate = useNavigate()
      const location = useLocation()
      return createElement(
        'div',
        { 'data-path': location.pathname },
        createElement('button', {
          'data-leave': true,
          onClick: () =>
            leaveDeletedCanvasRoute(
              location.pathname,
              'p1',
              navigate,
            ),
        }),
      )
    }

    let root!: TestRenderer.ReactTestRenderer
    act(() => {
      root = TestRenderer.create(
        createElement(
          MemoryRouter,
          { initialEntries: ['/canvas/p1'] },
          createElement(Probe),
        ),
      )
    })
    act(() => {
      root.root.findByProps({ 'data-leave': true }).props.onClick()
    })
    expect(
      root.root.findByProps({ 'data-path': '/projects' }),
    ).toBeDefined()
    act(() => root.unmount())
  })

  it('清掉已删除项目的技能监听，后续交接不再投递', () => {
    const listener = vi.fn()
    subscribeAgentSkillHandoff('p1', listener)
    sendSkillToAgent('p1', 'before')
    clearDeletedProjectState('p1')
    sendSkillToAgent('p1', 'after')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

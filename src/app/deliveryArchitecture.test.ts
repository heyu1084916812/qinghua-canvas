import { describe, expect, it } from 'vitest'
import routesText from './routes.tsx?raw'
import navText from './nav.ts?raw'
import workbenchText from '../domain/shared/workbench.ts?raw'
import { WORKBENCH_ORDER, WORKBENCHES } from '../domain/shared/workbench'

describe('工作台是编译期登记边界', () => {
  it('三个已登记工作台都有静态类型、路由和一级入口', () => {
    expect(WORKBENCH_ORDER).toEqual(['canvas', 'ecommerce', 'storyboard'])
    for (const id of WORKBENCH_ORDER) {
      expect(WORKBENCHES[id]?.routePrefix).toBe(`/${id}`)
      expect(routesText).toContain(`path="/${id}"`)
      expect(routesText).toContain(`path="/${id}/:projectId"`)
      expect(navText).toContain(`to: '/${id}'`)
    }
  })

  it('不把静态 lazy 边界误写成运行时插件系统', () => {
    expect(workbenchText).not.toContain('只剩 `canvas` 一个工作台')
    expect(workbenchText).toContain('不是运行时插件市场')
    expect(routesText).toContain('const CanvasPage = lazy(')
    expect(routesText).toContain('const EcommercePage = lazy(')
    expect(routesText).toContain('const StoryboardPage = lazy(')
  })
})

import { describe, expect, it } from 'vitest'
import { projectTreeLoadDecision } from './reload'

describe('projectTreeLoadDecision', () => {
  it('同一 revision 只加载一次，路由和选中变化不会重复扫表', () => {
    expect(projectTreeLoadDecision(true, 7, 7)).toBe('skip')
  })

  it('项目事件推进 revision 时重新加载', () => {
    expect(projectTreeLoadDecision(true, 8, 7)).toBe('load')
  })

  it('关闭项目树后重置，下一次打开重新加载', () => {
    expect(projectTreeLoadDecision(false, 8, 8)).toBe('reset')
  })
})

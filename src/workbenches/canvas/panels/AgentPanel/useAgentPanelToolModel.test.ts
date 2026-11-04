import { describe, expect, expectTypeOf, it } from 'vitest'
import type { AgentToolContext } from '../../agent/tools'
import type { AgentPanelToolModel } from './useAgentPanelToolModel'

/**
 * 工具领域 hook 的**结构契约**。
 *
 * `toolCtx` 的价值全在取值时机（thunk / 建 ctx 时现读），语义本身由
 * `agentPanelArchitecture.test.ts` 的源码级断言钉住；这里补的是这次拆分的两件事：
 * ① 本 hook 不持有任何会话桶；② 账本只有一个实例（两个账本 = 一次工具调用记两笔）。
 */
const SOURCE = (
  import.meta.glob('./useAgentPanelToolModel.ts', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
)['./useAgentPanelToolModel.ts']

const countOf = (needle: string): number => SOURCE.split(needle).length - 1

describe('useAgentPanelToolModel 的结构契约', () => {
  it('不创建任何会话桶，也不自带 state / effect', () => {
    expect(SOURCE).not.toMatch(/useRef\(\s*new (Map|Set)/)
    expect(SOURCE).not.toMatch(/\buseState\s*\(/)
    expect(SOURCE).not.toMatch(/\buseEffect\s*\(/)
  })

  it('不反向 import 面板本体', () => {
    expect(SOURCE).not.toMatch(/['"]\.\/AgentPanel(?:View)?(?:\.tsx)?['"]/)
  })

  it('toolCtx 只有一个定义，执行账本只有一个实例', () => {
    expect(countOf('const toolCtx = useCallback(')).toBe(1)
    expect(countOf('createAgentToolExecution(')).toBe(1)
    expect(countOf('executeConfirmedTool(')).toBe(1)
  })

  it('对外只暴露四个接线出口', () => {
    expectTypeOf<AgentPanelToolModel['toolCtx']>().returns.toEqualTypeOf<
      AgentToolContext
    >()
    expectTypeOf<AgentPanelToolModel['executeToolWithLedger']>().toBeFunction()
    expectTypeOf<
      AgentPanelToolModel['executeConfirmedToolWithLedger']
    >().toBeFunction()
    expectTypeOf<AgentPanelToolModel['toolExecution']>().toBeObject()
  })
})

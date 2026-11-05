import { describe, expect, it } from 'vitest'

const SOURCE = (
  import.meta.glob('./useAgentPanelTurnCore.ts', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
)['./useAgentPanelTurnCore.ts']

const countOf = (needle: string): number =>
  SOURCE.split(needle).length - 1

describe('useAgentPanelTurnCore 结构契约', () => {
  it('AgentLoop 主链的每个控制器只实例化一次', () => {
    for (const hook of [
      'useAgentAutoRunController(',
      'useAgentLoopDepsController(',
      'useAgentOutcomeCoordinator(',
      'useAgentPrepareTurnController(',
      'useAgentSendTurnController(',
      'useAgentSendController(',
    ]) {
      expect(countOf(hook), `${hook} 应当恰好出现一次`).toBe(1)
    }
  })

  it('自动执行上限仍由单一常量控制', () => {
    expect(SOURCE).toContain('const AUTO_RUN_LIMIT = 32')
    expect(countOf('maxSteps: AUTO_RUN_LIMIT')).toBe(1)
  })

  it('只负责运行主链，不重新拥有队列/确认/继续/停止控制器', () => {
    for (const hook of [
      'useAgentQueueController(',
      'useAgentConfirmationController(',
      'useAgentContinuationController(',
      'useAgentStopController(',
    ]) {
      expect(countOf(hook), `${hook} 不属于运行主链`).toBe(0)
    }
  })

  it('顺序模块只接线，不复制实现', () => {
    expect(countOf('continueAgentAutoConfirmations(')).toBe(1)
    expect(countOf('finishConfirmedTool: controller.finishConfirmedTool')).toBe(1)
    // import 一次 + 真正传给 loop/续跑端口一次
    expect(countOf('resumeAgentTurn,')).toBe(2)
    expect(countOf('runAgentTurn,')).toBe(2)
  })
})

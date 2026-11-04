import { describe, expect, expectTypeOf, it } from 'vitest'
import type { AgentPanelTurnModel } from './useAgentPanelTurnModel'

/**
 * 回合领域 hook 的**结构契约**。
 *
 * 这一层最容易在搬家时「顺手优化」：比如把自动执行上限写成字面量、把关停清单漏一条、
 * 或者把某个控制器实例化两次（两个队列控制器 = 一条消息排两次队）。这里把它们钉住。
 */
const SOURCE = (
  import.meta.glob('./useAgentPanelTurnModel.ts', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
)['./useAgentPanelTurnModel.ts']

const countOf = (needle: string): number => SOURCE.split(needle).length - 1

describe('useAgentPanelTurnModel 的结构契约', () => {
  it('不创建任何会话桶（全部来自 useAgentPanelRefs）', () => {
    expect(SOURCE).not.toMatch(/useRef\(\s*new (Map|Set)/)
  })

  it('不反向 import 面板本体', () => {
    expect(SOURCE).not.toMatch(/['"]\.\/AgentPanel(?:View)?(?:\.tsx)?['"]/)
  })

  it('每个回合控制器在这里只实例化一次', () => {
    for (const hook of [
      'useAgentAutoRunController(',
      'useAgentLoopDepsController(',
      'useAgentOutcomeCoordinator(',
      'useAgentPrepareTurnController(',
      'useAgentSendTurnController(',
      'useAgentSendController(',
      'useAgentQueueController(',
      'useAgentInterruptSettlementController(',
      'useAgentSteeringController(',
      'useAgentTaskPlanController(',
      'useAgentConfirmationController(',
      'useAgentContinuationController(',
      'useAgentStopController(',
    ]) {
      expect(countOf(hook), `${hook} 应当恰好出现一次`).toBe(1)
    }
  })

  /** 自动执行上限是「确认 → 执行」绕圈的安全阀，写死成字面量就失去了单一来源 */
  it('自动执行上限仍走常量，且真的传进了续跑入口', () => {
    expect(SOURCE).toContain('const AUTO_RUN_LIMIT = 32')
    expect(SOURCE).toContain('maxSteps: AUTO_RUN_LIMIT')
  })

  /**
   * 关停清单是**契约**：面板关掉时必须把这一轮所有按会话分桶的东西清干净。
   * 这几条是清单里最容易在搬家时被漏掉的（它们没有类型约束保护）。
   */
  it('关停清单里的关键清理一条都没少，且只在一处', () => {
    for (const clear of [
      'sessionRuntimeRef.current.clearSession(sessionId)',
      'abortRefs.current.clear()',
      'deliveredSteersRef.current.clear()',
      'toolModeRef.current.clear()',
      'turnToolsRef.current.clear()',
      'currentTurnIdRef.current.clear()',
      'currentTurnJobIdRef.current.clear()',
      'currentTurnRevisionRef.current.clear()',
      'planAliasesRef.current.clear()',
      'explicitMediaModelsRef.current.clear()',
      'contextTraceRef.current.clear()',
      'inFlightConfirmationRef.current.clear()',
    ]) {
      expect(countOf(clear), `${clear} 缺了`).toBe(1)
    }
    // 这三条同时出现在「任务计划推进的清理」与「关停清单」两处，各一次才正确
    for (const clear of [
      'clearLiveActivitiesFor(sessionId)',
      'clearLiveProcessFor(sessionId)',
      'clearRunTasksFor(sessionId)',
    ]) {
      expect(countOf(clear), `${clear} 次数不对`).toBe(2)
    }
    expect(countOf('clearAutoRuns()')).toBe(1)
    expect(countOf('clearChatRoutes()')).toBe(1)
    expect(countOf('cancelPendingAssetSync()')).toBe(1)
  })

  /** 确认卡两条动作共用 `confirmingRef`，自动执行只认 `confirmRef` 这一条出口 */
  it('confirmRef 仍由确认控制器赋值（自动执行路径靠它调“确认最新一张”）', () => {
    expect(countOf('confirmRef.current = confirm')).toBe(1)
  })

  /** 顺序语义所在模块只许被「接线引用」一次，不在这里重写成第二份实现 */
  it('顺序编排模块只被引用，不在这里重新实现', () => {
    expect(countOf('runConfirmation: runAgentConfirmation,')).toBe(1)
    expect(countOf('runContinuation: runAgentContinuation,')).toBe(1)
    expect(countOf('continueAgentAutoConfirmations(')).toBe(1)
    expect(countOf('finishConfirmedTool: controller.finishConfirmedTool')).toBe(1)
  })

  it('对外暴露的动作都是函数', () => {
    expectTypeOf<AgentPanelTurnModel['send']>().toBeFunction()
    expectTypeOf<AgentPanelTurnModel['retry']>().toBeFunction()
    expectTypeOf<AgentPanelTurnModel['stop']>().toBeFunction()
    expectTypeOf<AgentPanelTurnModel['confirm']>().toBeFunction()
    expectTypeOf<AgentPanelTurnModel['continueTask']>().toBeFunction()
  })
})

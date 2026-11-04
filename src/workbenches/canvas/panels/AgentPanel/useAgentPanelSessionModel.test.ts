import { describe, expect, expectTypeOf, it } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentPanelSessionModel } from './useAgentPanelSessionModel'

/**
 * 会话领域 hook 的**结构契约**。
 *
 * 这里测的不是业务行为（那些在各自的控制器 / 模块测试里），而是这次「面板瘦身」最怕
 * 出现的事故：**同一个领域被实例化两份**。两份 composer / 两份会话列表不会立刻报错，
 * 只会表现为「草稿在 A 面板里有、B 面板里没有」这种谁都复现不了的怪 bug。
 */
const SOURCE = (
  import.meta.glob('./useAgentPanelSessionModel.ts', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
)['./useAgentPanelSessionModel.ts']

const countOf = (needle: string): number => SOURCE.split(needle).length - 1

describe('useAgentPanelSessionModel 的结构契约', () => {
  it('不自己创建任何按会话分桶的 ref（宿主只能是 useAgentPanelRefs）', () => {
    expect(SOURCE).not.toMatch(/useRef\(\s*new (Map|Set)/)
  })

  it('不反向 import 面板本体', () => {
    expect(SOURCE).not.toMatch(/['"]\.\/AgentPanel(?:View)?(?:\.tsx)?['"]/)
  })

  it('每个领域控制器在这里只实例化一次', () => {
    for (const hook of [
      'useAgentRunPresentation(',
      'useAgentSessionLifecycle(',
      'useAgentComposerController(',
      'useAgentChatRouting(',
      'useAgentModelSelectionController(',
      'useAgentInitialLoadController(',
      'useAgentSessionActionsController(',
      'useAgentSkillsController(',
      'useAgentSkillChipReset(',
      'useAgentAttachmentsController(',
      'useAgentConversationController(',
    ]) {
      expect(countOf(hook), `${hook} 应当恰好出现一次`).toBe(1)
    }
  })

  /**
   * 队列菜单的三条关闭路径（点外面 / 滚动或改窗口 / Esc）是修过的老 bug：
   * 少一条，菜单就会挂在屏幕上关不掉。搬进 hook 时一条都不许丢。
   */
  it('队列菜单的四条收起监听取消时一一对应', () => {
    for (const listener of [
      "document.addEventListener('pointerdown'",
      "document.addEventListener('scroll'",
      "window.addEventListener('keydown'",
      "window.addEventListener('resize'",
    ]) {
      expect(countOf(listener), `${listener} 缺了`).toBe(1)
    }
    expect(countOf('removeEventListener(')).toBe(4)
  })

  /** 切会话时三件事必须一起复位，否则「切走再切回」会带着上一个会话的草稿 / 滚动位置 */
  it('切会话复位三条都还在（草稿 / 对话 / 会话动作）', () => {
    expect(SOURCE).toContain('composerResetForSessionRef.current(session.id)')
    expect(SOURCE).toContain(
      'conversationResetForSessionRef.current(session.id)',
    )
    expect(SOURCE).toContain('sessionActionsResetRef.current()')
  })

  it('返回类型仍然把「当前会话」暴露成 AgentSession | null', () => {
    expectTypeOf<AgentPanelSessionModel['current']>().toMatchTypeOf<
      AgentSession | null
    >()
    expectTypeOf<AgentPanelSessionModel['refresh']>().toBeFunction()
    expectTypeOf<AgentPanelSessionModel['applySessionSnapshot']>().toBeFunction()
  })
})

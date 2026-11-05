import { describe, expect, it } from 'vitest'
import activityStyles from './AgentActivityViews.module.css'

const MAIN_SOURCE = (
  import.meta.glob('./AgentPanel.module.css', {
    eager: true,
      query: '?inline',
    import: 'default',
  }) as Record<string, string>
)['./AgentPanel.module.css']

const MODULE_SOURCES = import.meta.glob(
  './Agent{ActivityViews,ComposerPane,ConversationMessages,ConversationSteps,QueuePanel}.module.css',
  {
    eager: true,
    query: '?inline',
    import: 'default',
  },
) as Record<string, string>

const countLines = (source: string): number => {
  const parts = source.split('\n').length
  return source.endsWith('\n') ? parts - 1 : parts
}

const braceDelta = (source: string): number =>
  (source.match(/\{/g) ?? []).length - (source.match(/\}/g) ?? []).length

describe('AgentPanel CSS 结构护栏', () => {
  it('主样式只保留共享壳，不再长回千行', () => {
    expect(MAIN_SOURCE, '没读到 AgentPanel.module.css').toBeTypeOf('string')
    expect(countLines(MAIN_SOURCE)).toBeLessThanOrEqual(300)
  })

  it('每个组件样式模块都控制在可读体量', () => {
    expect(Object.keys(MODULE_SOURCES)).toHaveLength(5)
    for (const [path, source] of Object.entries(MODULE_SOURCES)) {
      expect(source, `${path} 没读到`).toBeTypeOf('string')
      expect(countLines(source), `${path} 超预算`).toBeLessThanOrEqual(450)
    }
  })

  it('所有模块花括号配平，且没有提取脚本伪行', () => {
    for (const [path, source] of [
      ['AgentPanel.module.css', MAIN_SOURCE],
      ...Object.entries(MODULE_SOURCES),
    ] as const) {
      expect(braceDelta(source), `${path} 花括号不配平`).toBe(0)
      expect(source, `${path} 混入脚本对象文本`).not.toContain(
        'System.Object[]',
      )
    }
  })

  it('打字机保留可见文本和读屏文本，但读屏副本必须真正隐藏', () => {
    expect(activityStyles.srOnly).toBeTruthy()
  })

  it('组件实际引用对应的样式模块', () => {
    const components = import.meta.glob(
      './Agent{ActivityViews,ComposerPane,ConversationPane,QueuePanel}.tsx',
      {
        eager: true,
        query: '?raw',
        import: 'default',
      },
    ) as Record<string, string>
    expect(components['./AgentActivityViews.tsx']).toContain(
      "from './AgentActivityViews.module.css'",
    )
    expect(components['./AgentComposerPane.tsx']).toContain(
      "from './AgentComposerPane.module.css'",
    )
    expect(components['./AgentConversationPane.tsx']).toContain(
      "from './AgentConversationMessages.module.css'",
    )
    expect(components['./AgentConversationPane.tsx']).toContain(
      "from './AgentConversationSteps.module.css'",
    )
    expect(components['./AgentQueuePanel.tsx']).toContain(
      "from './AgentQueuePanel.module.css'",
    )
  })
})

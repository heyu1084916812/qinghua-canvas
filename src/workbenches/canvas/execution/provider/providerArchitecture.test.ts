import { describe, expect, it } from 'vitest'

const sources = import.meta.glob('../*.tsx', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const provider = sources['../CanvasExecutionProvider.tsx'] ?? ''

function countLines(source: string): number {
  return source.trimEnd().split('\n').length
}

describe('canvas execution provider architecture', () => {
  it('countLines 覆盖末尾换行与空源码', () => {
    expect(countLines('a\nb\n')).toBe(2)
    expect(countLines('')).toBe(1)
  })

  it('Provider 降到 1000 行以下，并保留唯一渲染出口与八项 API', () => {
    expect(provider).not.toBe('')
    expect(countLines(provider)).toBeLessThan(1000)
    expect(provider).toContain('<CanvasExecutionValueProvider value={api}>')
    expect(provider).toContain('<RunHotkeys />')
    for (const apiName of [
      'runNode',
      'runGroup',
      'cancel',
      'nodeStateOf',
      'nodeStates',
      'isRunning',
      'appendRecord',
      'completeText',
    ]) {
      expect(provider).toContain(apiName)
    }
  })

  it('Provider 独占启动、取消、排队与状态注入顺序', () => {
    for (const anchor of [
      'const launch = useCallback(',
      'const cancel = useCallback(',
      "n.set(t.nodeId, { kind: 'queued' })",
      'await startRun(plan)',
      'await store.flush()',
      'bindAbortToCancel',
      'registerGuardedChannelRun',
      'runtime.taskToNodeMaps.set(plan.id, taskToNode)',
    ]) {
      expect(provider).toContain(anchor)
    }
  })

  it('取消链接仍贯通准备阶段、循环、批次、文本与分组', () => {
    expect(provider).toContain('linkRunSignal(runtime.engine, request.signal)')
    expect(provider).toContain('linkRunSignal(runtime.engine, opts?.signal)')
    expect(provider).toContain('linkRunSignal(runtime.engine)')
    expect(provider).toContain('runCanvasLoop(loopNode, contextAssets, signal,')
    expect(provider).toContain('applySelectedSkill(node, signal')
    expect(provider).toContain('applyComposeFromDraft(node, signal')
    expect(provider).toContain('launch(plan, target.id, signal)')
  })

  it('业务控制器住在 provider/ 且源码不引入 React 或 JSX', () => {
    const controllers = import.meta.glob('./*.ts', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>
    const production = Object.entries(controllers)
      .filter(([name]) => !name.endsWith('.test.ts'))
    const names = production.map(([name]) => name).sort()
    expect(names).toEqual([
      './loopRunPlan.ts',
      './promptPreparation.ts',
      './runCallbacks.ts',
      './textExecution.ts',
    ])
    for (const [, source] of production) {
      expect(countLines(source)).toBeLessThanOrEqual(450)
      expect(source).not.toMatch(/from ['"]react['"]/)
      expect(source).not.toMatch(/=\s*<[A-Za-z][A-Za-z0-9]*(\s|>|\/>)/)
      expect(source).not.toMatch(/return\s*\(?\s*<[A-Za-z][A-Za-z0-9]*(\s|>|\/>)/)
    }
  })
})

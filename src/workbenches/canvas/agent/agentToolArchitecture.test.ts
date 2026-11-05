import { describe, expect, it } from 'vitest'
import * as planGate from './agentPlanGate'
import * as tools from './tools'

const sources = {
  tools: (
    import.meta.glob('./tools.ts', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>
  )['./tools.ts'],
  planGate: (
    import.meta.glob('./agentPlanGate.ts', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>
  )['./agentPlanGate.ts'],
  canvasMutations: (
    import.meta.glob('./agentCanvasMutationTools.ts', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>
  )['./agentCanvasMutationTools.ts'],
}

const countLines = (source: string): number => {
  const parts = source.split('\n').length
  return source.endsWith('\n') ? parts - 1 : parts
}

describe('Agent 工具模块结构护栏', () => {
  it('行数口径自检：末尾换行不算一行', () => {
    expect(countLines('a')).toBe(1)
    expect(countLines('a\n')).toBe(1)
    expect(countLines('a\nb\n')).toBe(2)
  })

  it('tools.ts 保持分发入口体量，不再长回千行文件', () => {
    expect(sources.tools, '没读到 tools.ts 原文').toBeTypeOf('string')
    expect(countLines(sources.tools)).toBeLessThanOrEqual(820)
  })

  it('计划校验和画布变更工具各自守住体量上限', () => {
    expect(sources.planGate, '没读到 agentPlanGate.ts 原文').toBeTypeOf(
      'string',
    )
    expect(sources.canvasMutations, '没读到画布工具原文').toBeTypeOf('string')
    expect(countLines(sources.planGate)).toBeLessThanOrEqual(210)
    expect(countLines(sources.canvasMutations)).toBeLessThanOrEqual(410)
  })

  it('tools.ts 原有计划校验导出仍指向同一份实现', () => {
    expect(tools.planProblems).toBe(planGate.planProblems)
    expect(tools.promptlessGenerationProblems).toBe(
      planGate.promptlessGenerationProblems,
    )
  })

  it('被搬走的实现不能偷偷复制回 tools.ts', () => {
    expect(sources.tools).not.toContain('function disambiguateAttachAliases')
    expect(sources.tools).not.toContain('async function moveNodesInStore')
    expect(sources.canvasMutations).toContain(
      'export async function moveNodesInStore',
    )
    expect(sources.planGate).toContain('export function planProblems')
  })
})

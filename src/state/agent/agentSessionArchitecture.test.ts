import { describe, expect, it } from 'vitest'
import { createAgentSessionStore } from './sessionStore'

const sources = {
  store: (
    import.meta.glob('./sessionStore.ts', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>
  )['./sessionStore.ts'],
  types: (
    import.meta.glob('./agentSessionTypes.ts', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>
  )['./agentSessionTypes.ts'],
  persistence: (
    import.meta.glob('./agentSessionPersistence.ts', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>
  )['./agentSessionPersistence.ts'],
}

const countLines = (source: string): number => {
  const parts = source.split('\n').length
  return source.endsWith('\n') ? parts - 1 : parts
}

describe('Agent 会话存储结构护栏', () => {
  it('行数口径自检：末尾换行不算一行', () => {
    expect(countLines('a')).toBe(1)
    expect(countLines('a\n')).toBe(1)
    expect(countLines('a\nb\n')).toBe(2)
  })

  it('store 只保留事务 API，不再长回千行文件', () => {
    expect(sources.store, '没读到 sessionStore.ts 原文').toBeTypeOf('string')
    expect(countLines(sources.store)).toBeLessThanOrEqual(790)
  })

  it('类型契约与持久化映射各自守住体量上限', () => {
    expect(sources.types, '没读到 agentSessionTypes.ts 原文').toBeTypeOf(
      'string',
    )
    expect(
      sources.persistence,
      '没读到 agentSessionPersistence.ts 原文',
    ).toBeTypeOf('string')
    expect(countLines(sources.types)).toBeLessThanOrEqual(290)
    expect(countLines(sources.persistence)).toBeLessThanOrEqual(240)
  })

  it('类型契约文件保持 type-only，不偷偷带运行时实现', () => {
    expect(sources.types).not.toMatch(/^import(?!\s+type\b)/m)
    expect(sources.types).not.toMatch(
      /^export\s+(?:const|function|class|let|var)\b/m,
    )
  })

  it('行映射与迁移实现只在持久化模块，store 继续提供原工厂', () => {
    expect(typeof createAgentSessionStore).toBe('function')
    expect(sources.store).not.toContain('const toSession =')
    expect(sources.store).not.toContain('const replaceMessages =')
    expect(sources.persistence).toContain('export const toSession =')
    expect(sources.persistence).toContain('export const replaceMessages =')
  })
})

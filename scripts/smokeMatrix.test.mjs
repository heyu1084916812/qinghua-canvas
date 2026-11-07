import { describe, expect, it } from 'vitest'
import { groupPlan, groupPort, healthOk, RESERVED_PORTS } from './smoke-matrix.mjs'

describe('smoke-matrix isolation plan', () => {
  it('gives each group an explicit isolated store port, data dir, and proxy env', () => {
    const plan0 = groupPlan(0, 'E:/tmp/run', 18800, 'g8')
    const plan1 = groupPlan(1, 'E:/tmp/run', 18800, 'g44')
    expect(plan0.storeArgs).toEqual([
      '--data-dir',
      'E:\\tmp\\run\\000-g8\\localappdata\\com.qinghua.canvas\\shared-store-v1',
      '--backend',
      'v1',
      '--port',
      '18800',
    ])
    expect(plan1.storeArgs).toContain('--port')
    expect(plan1.storeArgs[plan1.storeArgs.indexOf('--port') + 1]).toBe('18801')
    expect(plan0.healthUrl).toBe('http://127.0.0.1:18800/health')
    expect(plan0.smokeEnv.SMOKE_STORE_BASE).toBe('http://127.0.0.1:18800')
    expect(plan1.smokeEnv.SMOKE_STORE_BASE).toBe('http://127.0.0.1:18801')
    expect(plan0.port).not.toBe(plan1.port)
    expect(plan0.dataDir).not.toBe(plan1.dataDir)
    expect(plan0.groupRoot).toBe('E:\\tmp\\run\\000-g8')
    expect(plan1.groupRoot).toBe('E:\\tmp\\run\\001-g44')
  })

  it('never plans a port on a known resident service', () => {
    for (const reserved of RESERVED_PORTS) {
      expect(() => groupPort(reserved - 18800, 18800)).toThrow(/conflicts with a reserved port/)
    }
    expect(RESERVED_PORTS.has(18800)).toBe(false)
    expect(RESERVED_PORTS.has(18801)).toBe(false)
  })

  it('accepts only a matching isolated v1 health payload', () => {
    const plan = groupPlan(0, 'E:/tmp/run')
    expect(healthOk(
      {
        ok: true,
        version: 8,
        backend: 'json-v1',
        dataDir: plan.dataDir,
      },
      plan.dataDir,
    )).toBe(true)
    expect(healthOk(
      {
        ok: true,
        version: 8,
        backend: 'sqlite-v2',
        dataDir: 'E:/software/data-v2',
      },
      plan.dataDir,
    )).toBe(false)
    expect(healthOk(
      {
        ok: true,
        version: 8,
        backend: 'json-v1',
        dataDir: 'E:/somewhere/else',
      },
      plan.dataDir,
    )).toBe(false)
    expect(healthOk({ ok: true, version: 4, backend: 'json-v1', dataDir: plan.dataDir }, plan.dataDir)).toBe(false)
    expect(healthOk({ ok: false, version: 8, backend: 'json-v1', dataDir: plan.dataDir }, plan.dataDir)).toBe(false)
  })
})

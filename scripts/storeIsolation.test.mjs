import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertIsolatedStore, isIsolatedDataDir } from './storeIsolation.mjs'

const repo = path.resolve(import.meta.dirname, '..')
const health = (dataDir) => async () => ({ json: async () => ({ ok: true, dataDir }) })

describe('隔离数据目录护栏（#1130 H4）', () => {
  it('临时目录 / .playwright-verify / 显式根 → 放行；仓库 data-v2、用户目录 → 拒绝', () => {
    expect(isIsolatedDataDir('/tmp/qh-rh', {}, ['/tmp'])).toBe(true)
    expect(isIsolatedDataDir(path.join(repo, '.playwright-verify', 'smoke-matrix', 'r1', '001-g1', 'data'), {}, ['/tmp'])).toBe(true)
    expect(isIsolatedDataDir('/srv/qa/store', { QINGHUA_ISOLATED_ROOTS: '/srv/qa' }, ['/tmp'])).toBe(true)
    expect(isIsolatedDataDir(path.join(repo, 'data-v2'), {}, ['/tmp'])).toBe(false)
    expect(isIsolatedDataDir('/home/me/AppData/Local/com.qinghua.canvas/shared-store-v1', {}, ['/tmp'])).toBe(false)
    expect(isIsolatedDataDir('/tmpfoo/x', {}, ['/tmp'])).toBe(false)
    expect(isIsolatedDataDir('', {}, ['/tmp'])).toBe(false)
  })

  it('assertIsolatedStore：非隔离抛错；显式覆盖放行；读不到 health 也拒绝', async () => {
    await expect(assertIsolatedStore('http://s', {}, health(path.join(repo, 'data-v2')))).rejects.toThrow(/拒绝在非隔离数据目录/)
    await expect(assertIsolatedStore('http://s', { QINGHUA_ALLOW_SHARED_STORE: '1' }, health(path.join(repo, 'data-v2')))).resolves.toEqual({ allowed: 'override' })
    await expect(assertIsolatedStore('http://s', {}, async () => { throw new Error('ECONNREFUSED') })).rejects.toThrow(/无法确认/)
    await expect(assertIsolatedStore('http://s', {}, health('/tmp/qh-x'))).resolves.toMatchObject({ allowed: 'isolated' })
  })
})

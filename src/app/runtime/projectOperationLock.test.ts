import { describe, expect, it } from 'vitest'
import { createProjectOperationLock } from './projectOperationLock'

class BusyError extends Error {
  constructor(readonly projectIds: readonly string[]) {
    super(`busy: ${projectIds.join(',')}`)
    this.name = 'BusyError'
  }
}

function createLock() {
  return createProjectOperationLock({
    onBusy: (projectIds) => {
      throw new BusyError(projectIds)
    },
  })
}

describe('projectOperationLock', () => {
  it('多项目 claim 全有或全无，不产生部分占用', () => {
    const lock = createLock()
    const first = lock.claim(['p1'])

    expect(() => lock.claim(['p2', 'p1', 'p3'])).toThrow(BusyError)
    expect(lock.get('p1')).toBe(first)
    expect(lock.get('p2')).toBeUndefined()
    expect(lock.get('p3')).toBeUndefined()

    const second = lock.claim(['p2', 'p3'])
    expect(lock.get('p2')).toBe(second)
    expect(lock.get('p3')).toBe(second)
  })

  it('重复 projectId 去重，空 claim 不占用任何项目', () => {
    const lock = createLock()
    const duplicate = lock.claim(['p1', 'p1'])
    expect([...duplicate.projectIds]).toEqual(['p1'])
    expect(lock.forExactIds(['p1', 'p1'])).toBe(duplicate)

    const empty = lock.claim([])
    expect([...empty.projectIds]).toEqual([])
    expect(lock.forExactIds([])).toBeNull()
    expect(lock.get('p1')).toBe(duplicate)
  })

  it('旧 token 只能条件释放自己，不能清掉新 token', () => {
    const lock = createLock()
    const previous = lock.claim(['p1'])
    expect(lock.release(previous)).toBe(true)

    const current = lock.claim(['p1'])
    expect(previous.owner).not.toBe(current.owner)
    expect(lock.release(previous)).toBe(false)
    expect(lock.release(previous)).toBe(false)
    expect(lock.get('p1')).toBe(current)
    expect(lock.release(current)).toBe(true)
    expect(lock.get('p1')).toBeUndefined()
  })

  it('精确查询、稳定枚举与 reset 保持 owner identity', () => {
    const lock = createLock()
    const shared = lock.claim(['p1', 'p2'])
    const other = lock.claim(['p3'])

    expect(lock.forExactIds(['p1', 'p2'])).toBe(shared)
    expect(lock.forExactIds(['p2', 'p1'])).toBe(shared)
    expect(lock.forExactIds(['p1'])).toBeNull()
    expect(lock.forExactIds(['p1', 'p3'])).toBeNull()
    expect(lock.owners()).toEqual([shared, other])
    expect(lock.owners()).toEqual([shared, other])
    expect(shared.owner).not.toBe(other.owner)

    lock.clear()
    expect(lock.owners()).toEqual([])
    expect(lock.get('p1')).toBeUndefined()
    expect(lock.claim(['p1']).id).toBe(1)
  })
})

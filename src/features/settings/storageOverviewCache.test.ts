import { describe, expect, it } from 'vitest'
import type { StoragePort } from '../../platform/ports'
import {
  readStorageOverviewSnapshot,
  rememberStorageOverviewUpdate,
} from './storageOverviewCache'

describe('storageOverviewCache', () => {
  it('keeps independently published fields per storage port', () => {
    const first = {} as StoragePort
    const second = {} as StoragePort

    expect(readStorageOverviewSnapshot(first)).toBeNull()
    rememberStorageOverviewUpdate(first, {
      kind: 'usage',
      usage: { used: 10, quota: 100 },
    })
    rememberStorageOverviewUpdate(first, {
      kind: 'projects',
      projects: 335,
    })
    rememberStorageOverviewUpdate(second, {
      kind: 'cache',
      cacheBytes: 42,
    })

    expect(readStorageOverviewSnapshot(first)).toMatchObject({
      usage: { used: 10, quota: 100 },
      projects: 335,
    })
    expect(readStorageOverviewSnapshot(first)?.cacheBytes).toBeUndefined()
    expect(readStorageOverviewSnapshot(second)).toEqual({ cacheBytes: 42 })
  })
})

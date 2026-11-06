import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  rootKindLabel,
  storageUsagePercent,
} from './StoragePanel'

describe('StoragePanel helpers', () => {
  it('formats storage sizes without inventing precision', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB')
  })

  it('returns a bounded percentage only when quota is real', () => {
    expect(storageUsagePercent(null)).toBeNull()
    expect(storageUsagePercent({ used: 10, quota: 0 })).toBeNull()
    expect(storageUsagePercent({ used: 25, quota: 100 })).toBe(25)
    expect(storageUsagePercent({ used: 120, quota: 100 })).toBe(100)
    expect(storageUsagePercent({ used: 1, quota: 3 })).toBe(33.3)
  })

  it('labels every resource-root state without pretending partial data is usable', () => {
    expect(
      rootKindLabel({ path: 'D:/data', kind: 'v2', ready: true }),
    ).toBe('V2')
    expect(
      rootKindLabel({ path: 'D:/data', kind: 'partial', ready: false }),
    ).toBe('迁移未完成')
    expect(
      rootKindLabel({ path: 'D:/data', kind: 'unknown', ready: false }),
    ).toBe('不可用')
  })
})

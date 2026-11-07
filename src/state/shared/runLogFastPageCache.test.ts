import { describe, expect, it } from 'vitest'
import type { StoragePort } from '../../platform/ports'
import {
  readRunLogFastPageCache,
  rememberRunLogFastPage,
} from './runLogFastPageCache'

describe('runLogFastPageCache', () => {
  it('isolates cached first pages by storage, filter and page size', () => {
    const first = {} as StoragePort
    const second = {} as StoragePort
    const filter = { aggregate: true }
    const page = { entries: [], hasMore: false, nextOffset: 0 }

    expect(readRunLogFastPageCache(first, filter, 50)).toBeNull()
    rememberRunLogFastPage(first, filter, 50, page)

    expect(readRunLogFastPageCache(first, filter, 50)).toBe(page)
    expect(readRunLogFastPageCache(first, filter, 20)).toBeNull()
    expect(readRunLogFastPageCache(first, { aggregate: false }, 50)).toBeNull()
    expect(readRunLogFastPageCache(second, filter, 50)).toBeNull()
  })
})

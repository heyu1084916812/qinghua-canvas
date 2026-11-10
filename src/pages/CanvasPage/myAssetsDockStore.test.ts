import { describe, expect, it, vi } from 'vitest'
import { createMyAssetsDockStore } from './myAssetsDockStore'

describe('my assets dock store', () => {
  it('publishes only real open-state changes', () => {
    const dock = createMyAssetsDockStore()
    const listener = vi.fn()
    const unsubscribe = dock.subscribe(listener)

    expect(dock.getSnapshot()).toBe(false)
    dock.setOpen(false)
    expect(listener).not.toHaveBeenCalled()
    dock.setOpen(true)
    expect(dock.getSnapshot()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    dock.toggle()
    expect(dock.getSnapshot()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    dock.toggle()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { Channel } from '../../../domain/project/channel'
import {
  applySelectedChannelChange,
  clearMapSaveTimers,
  clearTimedNotice,
  watchChannelMenu,
  watchProfileDrawer,
} from './settingsInteractionLifecycle'

const channel = (groups = 2): Channel =>
  ({
    id: 'a',
    name: '渠道 a',
    protocol: 'openai-compatible',
    baseUrl: 'https://a.example/v1',
    enabled: true,
    hasToken: true,
    credentialGroups: Array.from({ length: groups }, (_, index) => ({
      id: `a-g${index}`,
      name: `组 ${index}`,
      priority: index % 2,
      createdAt: index,
      hasToken: true,
      models: [],
      modelCache: [],
    })),
  }) as unknown as Channel

describe('选中渠道复位', () => {
  it('先撤旧 UI 与计时器，再按排序写首个组和表单', () => {
    const calls: string[] = []
    applySelectedChannelChange(channel(), {
      resetPanel: () => calls.push('panel'),
      resetChannelMenu: () => calls.push('menu'),
      resetMapDrafts: () => calls.push('drafts'),
      resetMapSaveNotice: () => calls.push('notice'),
      resetMapTests: () => calls.push('tests'),
      clearMapSaveTimers: () => calls.push('timers'),
      setActiveGroupId: (id) => calls.push(`group:${id}`),
      setForm: (form) => calls.push(`form:${form.name}`),
    })
    expect(calls).toEqual([
      'panel',
      'menu',
      'drafts',
      'notice',
      'tests',
      'timers',
      'group:a-g1',
      'form:渠道 a',
    ])
  })

  it('无选中渠道只复位旧状态', () => {
    const reset = vi.fn()
    applySelectedChannelChange(null, {
      resetPanel: reset,
      resetChannelMenu: reset,
      resetMapDrafts: reset,
      resetMapSaveNotice: reset,
      resetMapTests: reset,
      clearMapSaveTimers: reset,
      setActiveGroupId: vi.fn(),
      setForm: vi.fn(),
    })
    expect(reset).toHaveBeenCalledTimes(6)
  })
})

describe('渠道菜单生命周期', () => {
  const lifecycle = () => {
    const listeners: {
      pointer?: (target: unknown) => void
      key?: (event: { key: string; shiftKey: boolean; preventDefault(): void }) => void
      resize?: () => void
      scroll?: () => void
    } = {}
    const cleanup = [vi.fn(), vi.fn(), vi.fn(), vi.fn()]
    const ports = {
      setTimeout: vi.fn(() => 17),
      clearTimeout: vi.fn(),
      close: vi.fn(),
      focusFirstButton: vi.fn(),
      isInsideMenu: vi.fn((target: unknown) => target === 'inside'),
      onPointerDown: vi.fn((listener, capture) => {
        expect(capture).toBe(true)
        listeners.pointer = listener
        return cleanup[0]
      }),
      onKeyDown: vi.fn((listener) => {
        listeners.key = listener
        return cleanup[1]
      }),
      onResize: vi.fn((listener) => {
        listeners.resize = listener
        return cleanup[2]
      }),
      onScroll: vi.fn((listener) => {
        listeners.scroll = listener
        return cleanup[3]
      }),
    }
    return { listeners, cleanup, ports }
  }

  it('下一拍聚焦，外部点击/Esc/resize/scroll 关闭', () => {
    const { listeners, ports } = lifecycle()
    const stop = watchChannelMenu(true, ports)
    expect(ports.setTimeout).toHaveBeenCalledWith(ports.focusFirstButton, 0)
    listeners.pointer?.('inside')
    expect(ports.close).not.toHaveBeenCalled()
    listeners.pointer?.('outside')
    listeners.key?.({ key: 'Escape', shiftKey: false, preventDefault: vi.fn() })
    listeners.resize?.()
    listeners.scroll?.()
    expect(ports.close).toHaveBeenCalledTimes(4)
    stop()
    expect(ports.clearTimeout).toHaveBeenCalledWith(17)
  })

  it('cleanup 逐项移除四类监听，关闭态不注册', () => {
    const { cleanup, ports } = lifecycle()
    watchChannelMenu(true, ports)()
    for (const remove of cleanup) expect(remove).toHaveBeenCalledOnce()
    const off = lifecycle()
    watchChannelMenu(false, off.ports)
    expect(off.ports.setTimeout).not.toHaveBeenCalled()
    expect(off.ports.onPointerDown).not.toHaveBeenCalled()
  })
})

describe('资料抽屉生命周期', () => {
  const lifecycle = () => {
    const listeners: {
      key?: (event: { key: string; shiftKey: boolean; preventDefault(): void }) => void
      resize?: () => void
    } = {}
    const removeKey = vi.fn()
    const removeResize = vi.fn()
    const ports = {
      setTimeout: vi.fn(() => 23),
      clearTimeout: vi.fn(),
      syncBounds: vi.fn(),
      focusNameInput: vi.fn(),
      close: vi.fn(),
      trapTabFocus: vi.fn(),
      restoreFocus: vi.fn(),
      onKeyDown: vi.fn((listener) => {
        listeners.key = listener
        return removeKey
      }),
      onResize: vi.fn((listener) => {
        listeners.resize = listener
        return removeResize
      }),
    }
    return { listeners, removeKey, removeResize, ports }
  }

  it('打开测 bounds、下一拍聚焦、Tab 守卫、Esc 关闭', () => {
    const { listeners, ports } = lifecycle()
    watchProfileDrawer(true, ports)
    expect(ports.syncBounds).toHaveBeenCalledOnce()
    expect(ports.setTimeout).toHaveBeenCalledWith(ports.focusNameInput, 0)
    listeners.key?.({ key: 'Tab', shiftKey: false, preventDefault: vi.fn() })
    expect(ports.trapTabFocus).toHaveBeenCalledOnce()
    listeners.key?.({ key: 'Escape', shiftKey: false, preventDefault: vi.fn() })
    expect(ports.close).toHaveBeenCalledOnce()
  })

  it('resize 重测 bounds，cleanup 解绑并返回原焦点', () => {
    const { listeners, removeKey, removeResize, ports } = lifecycle()
    const stop = watchProfileDrawer(true, ports)
    listeners.resize?.()
    expect(ports.syncBounds).toHaveBeenCalledTimes(2)
    stop()
    expect(ports.clearTimeout).toHaveBeenCalledWith(23)
    expect(removeKey).toHaveBeenCalledOnce()
    expect(removeResize).toHaveBeenCalledOnce()
    expect(ports.restoreFocus).toHaveBeenCalledOnce()
  })
})

describe('notice 与映射计时器', () => {
  it('notice 到点清除，cleanup clearTimeout', () => {
    const clear = vi.fn()
    const setTimeout = vi.fn((handler: () => void) => {
      handler()
      return 31
    })
    const clearTimeout = vi.fn()
    const stop = clearTimedNotice(true, 1200, clear, { setTimeout, clearTimeout })
    expect(setTimeout).toHaveBeenCalledWith(clear, 1200)
    expect(clear).toHaveBeenCalledOnce()
    stop()
    expect(clearTimeout).toHaveBeenCalledWith(31)
  })

  it('全部映射计时器逐项清理并清空 owner', () => {
    const timers = new Map([
      ['a', 1],
      ['b', 2],
    ])
    const clearTimeout = vi.fn()
    clearMapSaveTimers(timers, clearTimeout)
    expect(clearTimeout.mock.calls).toEqual([[1], [2]])
    expect(timers.size).toBe(0)
  })
})

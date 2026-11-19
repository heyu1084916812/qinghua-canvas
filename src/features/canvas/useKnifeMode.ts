import { useEffect, useState, useSyncExternalStore } from 'react'
import { isTextEntryElement, isActivationTarget } from '../shared/textTarget'
import { isKnifeOn, setKnife, subscribeKnife, toggleKnife } from './knifeMode'

/** 订阅"美工刀开着吗"（画布壳、光标、指针层都读它） */
export function useKnifeOn(): boolean {
  return useSyncExternalStore(subscribeKnife, isKnifeOn, isKnifeOn)
}

/**
 * 空格 = 切换美工刀（用户 2026-11-19 拍板 A）。
 *
 * ⚠️ **这条口径改过**：以前"按住空格 + 拖 = 平移画布"（`useSpaceHeld`），现在空格专给刀具，
 * 平移交给**中键拖拽**（`panOnDrag={[0,1]}` 本来就支持，用户："平移中键可以进行拖，不需要改"）。
 * 所以这里必须 `preventDefault`：否则空格会去滚动画布容器 / 激活聚焦的按钮。
 *
 * 三条不接管（与 `useSpaceHeld` 同一套判断）：
 * - 文本输入框里要能打出空格；
 * - 焦点在按钮上时空格要激活控件（无障碍）；
 * - `repeat` 不算——按住不放只切一次，否则会疯狂来回。
 */
export function useKnifeShortcut(): void {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const target = e.target as { tagName?: string; isContentEditable?: boolean } | null
      if (isTextEntryElement(target) || isActivationTarget(target)) return
      e.preventDefault()
      toggleKnife()
    }
    /** Esc 退出刀具：与"关浮层"的通行键一致，用户不用再找一次空格 */
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!isKnifeOn()) return
      setKnife(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keydown', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keydown', up)
    }
  }, [])
}

/**
 * 刀具光标：跟着指针走的那把小刀。
 *
 * 为什么不用 CSS `cursor: url(...)`：那要求一张位图 + 固定热点，深浅主题下还得两张；
 * 而这里要的正是"项目自己的图标"，直接渲染 lucide 的 `Slice` 最省事、也跟着字色走。
 */
export function useKnifePointer(active: boolean): { x: number; y: number } {
  const [at, setAt] = useState({ x: -100, y: -100 })
  useEffect(() => {
    if (!active) return
    const move = (e: PointerEvent) => setAt({ x: e.clientX, y: e.clientY })
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [active])
  return at
}

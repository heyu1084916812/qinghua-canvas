import { useEffect, useRef, useSyncExternalStore } from 'react'
import { isTextEntryElement, isActivationTarget } from '../shared/textTarget'
import { isKnifeOn, setKnife, subscribeKnife } from './knifeMode'

/** 订阅"美工刀开着吗"（画布壳、光标、特效层都读它） */
export function useKnifeOn(): boolean {
  return useSyncExternalStore(subscribeKnife, isKnifeOn, isKnifeOn)
}

/**
 * **按住空格 = 美工刀，松开恢复**（用户 2026-11-19 定稿）。
 *
 * 四条硬约束（用户给的工程注意事项 1）：
 * - `e.repeat` 直接 return：按住不放时浏览器每秒几十次 keydown，不挡会把状态和光标闪成癫痫；
 * - 焦点隔离：输入框 / contentEditable 里空格是输入，按钮上空格是激活 —— 都不接管；
 * - 失焦 / 切标签页强制复位：`Alt+Tab` 之后收不到 keyup，不复位回来就永久卡在刀具态；
 * - **互斥锁** `canEnter`：正在拖节点 / 框选 / 拉新连线时按空格不切刀（由宿主判断）。
 */
export function useKnifeShortcut(options: { canEnter?: () => boolean } = {}): void {
  const canEnterRef = useRef(options.canEnter)
  canEnterRef.current = options.canEnter

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const target = e.target as { tagName?: string; isContentEditable?: boolean } | null
      if (isTextEntryElement(target) || isActivationTarget(target)) return
      if (isKnifeOn()) return
      if (canEnterRef.current && !canEnterRef.current()) return
      e.preventDefault()
      setKnife(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      setKnife(false)
    }
    /** 切走窗口 / 切标签页 / 失焦：一律松开（否则回来还卡在刀具态） */
    const reset = () => setKnife(false)
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') reset()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', reset)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', reset)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
}
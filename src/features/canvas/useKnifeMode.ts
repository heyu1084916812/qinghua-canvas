import { useEffect, useSyncExternalStore } from 'react'
import { isTextEntryElement, isActivationTarget } from '../shared/textTarget'
import { isKnifeOn, setKnife, subscribeKnife } from './knifeMode'

/** 订阅"美工刀按住了吗"（画布壳、光标、指针层都读它） */
export function useKnifeOn(): boolean {
  return useSyncExternalStore(subscribeKnife, isKnifeOn, isKnifeOn)
}

/**
 * **按住空格 = 美工刀，松开恢复**（用户 2026-11-19 第二轮定稿）。
 *
 * 上一版是"点一下切换"，用户实测手感不对（要再按一次才退出、容易忘在刀具态），
 * 改成按住式：压下即入刀具、抬起即回选择。与「按住 Alt 拖 = 复制」同一类**瞬态修饰键**。
 *
 * ⚠️ 口径变更史：空格以前是"按住 = 平移画布"（`useSpaceHeld`，已删）。现在空格专给刀具，
 * 平移交给**中键拖拽**（`panOnDrag={[0,1]}` 本来就支持，用户："平移中键可以进行拖，不需要改"）。
 *
 * 三条不接管（与旧实现同一套判断）：文本输入框里要能打出空格；焦点在按钮上时空格要激活控件
 * （无障碍）；`repeat` 不重复处理。
 */
export function useKnifeShortcut(): void {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const target = e.target as { tagName?: string; isContentEditable?: boolean } | null
      if (isTextEntryElement(target) || isActivationTarget(target)) return
      e.preventDefault()
      setKnife(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      setKnife(false)
    }
    /** 切走窗口 / 失焦时必须松开：否则回来还卡在刀具态（收不到那次 keyup） */
    const reset = () => setKnife(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', reset)
    }
  }, [])
}
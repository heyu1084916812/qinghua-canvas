/**
 * 画布「美工刀」模式（对账 #1159）。
 *
 * 两个来源：**按住空格**（held，松开即走）与**工具栏按钮**（pinned，点一下常驻，兼容触屏/单手）。
 * `isKnifeOn()` = held || pinned。
 *
 * 为什么单独一个小模块，而不塞进 canvas store：
 * 它**不是作品数据**（不落库、不进撤销栈、不参与指纹），只是"当前工具"；
 * 画布壳、指针层、光标、特效层四处都要读它，放 store 会把 1000 行的 store 再撑一段。
 */
let held = false
let pinned = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) fn()
}

export function isKnifeOn(): boolean {
  return held || pinned
}

/** 按住空格时的开关（松手调用 setKnife(false)） */
export function setKnife(next: boolean): void {
  if (held === next) return
  held = next
  notify()
}

/** 工具栏按钮的常驻开关 */
export function setKnifePinned(next: boolean): void {
  if (pinned === next) return
  pinned = next
  notify()
}

export function toggleKnifePinned(): void {
  setKnifePinned(!pinned)
}

export function subscribeKnife(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 仅供测试：复位成「关」。 */
export function __resetKnifeForTest(): void {
  held = false
  pinned = false
  notify()
}
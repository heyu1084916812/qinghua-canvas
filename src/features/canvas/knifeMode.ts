/**
 * 画布「美工刀」模式（对账 #1159，用户 2026-11-19 拍板 A：**空格专给刀具**）。
 *
 * 为什么单独一个小模块，而不塞进 canvas store：
 * - 它**不是作品数据**（不落库、不进撤销栈、不参与指纹），只是一个"当前工具"。
 * - 画布壳（指针层 / 光标）和键盘钩子两个地方都要读它；放 store 会把 900 行的
 *   store 再撑一段，而它跟 store 里那些业务字段没有任何耦合。
 *
 * 语义：开着的时候**左键不再选中 / 拖节点**，而是"切连线"；中键仍可平移（`panOnDrag` 已含 1），
 * 右键仍是菜单（用户明确：右键是菜单工具，不能改）。Esc 或再按一次空格退出。
 */
let on = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) fn()
}

export function isKnifeOn(): boolean {
  return on
}

export function setKnife(next: boolean): void {
  if (on === next) return
  on = next
  notify()
}

export function toggleKnife(): void {
  setKnife(!on)
}

export function subscribeKnife(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 仅供测试：复位成「关」。 */
export function __resetKnifeForTest(): void {
  on = false
  notify()
}

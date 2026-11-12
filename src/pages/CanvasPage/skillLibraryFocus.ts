/** 浮层焦点陷阱的纯规则：Tab 到末尾回到开头，Shift+Tab 到开头回到末尾。 */
export function focusTrapTarget<T>(
  focusables: readonly T[],
  active: T | null,
  backwards: boolean,
): T | null {
  if (focusables.length === 0) return null
  const first = focusables[0]!
  const last = focusables[focusables.length - 1]!
  const index = active === null ? -1 : focusables.indexOf(active)
  if (index === -1) return backwards ? last : first
  if (backwards && index === 0) return last
  if (!backwards && index === focusables.length - 1) return first
  return null
}

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** 在 `root` 内循环 Tab；返回是否接管了这次按键。 */
export function trapTabKey(event: KeyboardEvent | { key: string; shiftKey: boolean; preventDefault(): void }, root: HTMLElement): boolean {
  if (event.key !== 'Tab') return false
  const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hidden && el.getClientRects().length > 0,
  )
  const active = document.activeElement instanceof HTMLElement && root.contains(document.activeElement)
    ? document.activeElement
    : null
  const target = focusTrapTarget(focusables, active, event.shiftKey)
  if (!target) return false
  event.preventDefault()
  target.focus()
  return true
}

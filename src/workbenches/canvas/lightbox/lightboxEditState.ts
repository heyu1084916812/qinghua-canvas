/** 灯箱对比视图与标注撤销栈的纯状态规则。 */
import type { CompareView, LightboxEditorMode } from './lightboxKeyboard'
import type { MediaBox } from './lightboxViewportMath'

export function compareViewOf(mode: LightboxEditorMode, available: boolean, selected: CompareView): CompareView {
  return mode === 'compare' && available ? selected : 'first'
}

export function compareViewsOf(kind: 'pair' | 'result') {
  return kind === 'pair'
    ? ([
        { id: 'first' as const, label: 'A · 左' },
        { id: 'split' as const, label: '对比' },
        { id: 'second' as const, label: 'B · 右' },
      ])
    : ([
        { id: 'first' as const, label: '结果' },
        { id: 'split' as const, label: '对比' },
        { id: 'second' as const, label: '原图' },
      ])
}

export function compareClipPathOf(kind: 'pair' | 'result', splitRatio: number): string {
  return kind === 'pair'
    ? `inset(0 0 0 ${(splitRatio * 100).toFixed(3)}%)`
    : `inset(0 ${((1 - splitRatio) * 100).toFixed(3)}% 0 0)`
}

export function splitRatioAt(
  clientX: number,
  stage: { x: number },
  box: MediaBox | undefined,
  fallback: number,
): number {
  if (!box || box.width <= 0) return fallback
  const rel = clientX - stage.x - box.left
  return Math.min(0.95, Math.max(0.05, rel / box.width))
}

export function undoAnnotation<T>(ops: readonly T[]): { ops: T[]; undone: T[] } {
  if (ops.length === 0) return { ops: [...ops], undone: [] }
  const last = ops[ops.length - 1]!
  return { ops: ops.slice(0, -1), undone: [last] }
}

export function redoAnnotation<T>(ops: readonly T[], undone: readonly T[]): { ops: T[]; undone: T[] } {
  if (undone.length === 0) return { ops: [...ops], undone: [...undone] }
  const [first, ...rest] = undone
  return { ops: [...ops, first!], undone: rest }
}

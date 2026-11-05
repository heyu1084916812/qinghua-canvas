/** 灯箱键盘 / 手势规则：只返回决策，不注册 window 监听。 */
export type LightboxEditorMode =
  | 'view'
  | 'extract'
  | 'crop'
  | 'face'
  | 'annotate'
  | 'rotate'
  | 'compare'

export type CompareView = 'first' | 'split' | 'second'

export function isTextEditingTarget(target: {
  tagName?: string
  isContentEditable?: boolean
} | null): boolean {
  return (
    target?.isContentEditable === true ||
    target?.tagName === 'INPUT' ||
    target?.tagName === 'TEXTAREA'
  )
}

export type LightboxKeyAction =
  | { kind: 'close' }
  | { kind: 'navigate'; delta: -1 | 1 }
  | { kind: 'ignore' }

export function lightboxKeyAction(input: {
  key: string
  editingText: boolean
  mode: LightboxEditorMode
  hasGalleryNavigation: boolean
}): LightboxKeyAction {
  if (input.key === 'Escape' && !input.editingText) return { kind: 'close' }
  if (
    input.mode === 'view' &&
    input.hasGalleryNavigation &&
    !input.editingText &&
    (input.key === 'ArrowLeft' || input.key === 'ArrowRight')
  ) {
    return { kind: 'navigate', delta: input.key === 'ArrowLeft' ? -1 : 1 }
  }
  return { kind: 'ignore' }
}

export function shouldCloseOnStageClick(input: {
  cropping: boolean
  mode: LightboxEditorMode
  moved: boolean
}): boolean {
  if (input.cropping || input.mode === 'annotate' || input.mode === 'rotate') return false
  return !input.moved
}

export function isPrimaryPointer(button: number): boolean {
  return button === 0
}

export function isMiddlePointer(button: number): boolean {
  return button === 1
}

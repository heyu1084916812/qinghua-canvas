import { describe, expect, it } from 'vitest'
import { ContextKitsDialog } from './ContextKitsDialog'

const SOURCES = import.meta.glob(['./ContextKitsDialog.tsx', './ContextKit*.tsx'], {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>
const DIALOG_SOURCE = SOURCES['./ContextKitsDialog.tsx']!
/** 弹窗拆出的子组件（导入区、指南区）与本体合起来才是完整的渲染锚点集合。 */
const ALL_SOURCES = Object.values(SOURCES).join('\n')

describe('ContextKitsDialog 公共导出与页面锚点', () => {
  it('继续导出唯一的 ContextKitsDialog 组件入口', () => {
    expect(ContextKitsDialog).toBeTypeOf('function')
    expect(ContextKitsDialog.name).toBe('ContextKitsDialog')
    expect(DIALOG_SOURCE).toContain(
      'export function ContextKitsDialog({ onClose }: { onClose: () => void })',
    )
  })

  it('保留编辑、预览、素材选择和持久化入口的渲染锚点', () => {
    const anchors = [
      'data-context-kits',
      'data-context-kit-name',
      'data-context-asset-dropzone',
      'data-context-kit-guide',
      'data-context-kit-guide-generate',
      'data-context-logo-add',
      'data-context-reference-add',
      'data-context-kit-create-or-save',
      'data-context-kit-bind',
      'data-context-font-file',
      'data-context-font-library-list',
    ]
    for (const anchor of anchors) expect(ALL_SOURCES, anchor).toContain(anchor)
    expect(DIALOG_SOURCE).toContain('<ContextKitImportZone')
    expect(DIALOG_SOURCE).toContain('<ContextKitGuideSection')
  })
})

import { describe, expect, it } from 'vitest'
import { ContextKitsDialog } from './ContextKitsDialog'

const DIALOG_SOURCE = (
  import.meta.glob('./ContextKitsDialog.tsx', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
)['./ContextKitsDialog.tsx']

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
      'data-context-logo-add',
      'data-context-reference-add',
      'data-context-kit-create-or-save',
      'data-context-kit-bind',
      'data-context-font-file',
      'data-context-font-library-list',
    ]
    for (const anchor of anchors) expect(DIALOG_SOURCE, anchor).toContain(anchor)
  })
})

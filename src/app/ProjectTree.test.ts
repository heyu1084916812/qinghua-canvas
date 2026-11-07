import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ProjectDeleteConfirmActions } from './ProjectTree'

describe('ProjectTree delete confirmation', () => {
  it('项目运行时收尾期间禁用确认与取消，并显示忙碌状态', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectDeleteConfirmActions, {
        deleting: true,
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
      }),
    )

    expect(html).toContain('disabled=""')
    expect(html).toContain('收尾中…')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
  })

})

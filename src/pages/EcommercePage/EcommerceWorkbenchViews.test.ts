import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ToolIcon,
  WorkbenchResultPlaceholder,
  elapsedLabel,
} from './EcommerceWorkbenchViews'

const result = {
  id: 'r1',
  taskId: 't1',
  nodeId: 'n1',
  status: 'failed',
  error: '上游请求失败',
  createdAt: 0,
  updatedAt: 0,
} as never

describe('ecommerce workbench views', () => {
  it('renders failure and running result anchors without changing copy', () => {
    const failed = renderToStaticMarkup(createElement(WorkbenchResultPlaceholder, {
      result,
      status: 'failed',
      errorText: '上游请求失败',
      onRetry: () => {},
      onRemove: () => {},
    }))
    expect(failed).toContain('data-ecommerce-result-overlay="failed"')
    expect(failed).toContain('生成失败')
    expect(failed).toContain('data-ecommerce-retry-failed="n1"')
    expect(failed).toContain('data-ecommerce-remove-failed="n1"')

    const running = renderToStaticMarkup(createElement(WorkbenchResultPlaceholder, {
      result,
      status: 'running',
      errorText: '',
    }))
    expect(running).toContain('data-ecommerce-result-overlay="running"')
    expect(running).toContain('aria-live="polite"')
  })

  it('keeps tool glyphs and elapsed-time labels', () => {
    expect(renderToStaticMarkup(createElement(ToolIcon, { name: 'select' }))).toContain('svg')
    expect(renderToStaticMarkup(createElement(ToolIcon, { name: 'save' }))).toContain('svg')
    expect(elapsedLabel({ createdAt: 0, updatedAt: 999 } as never)).toBe('<1s')
    expect(elapsedLabel({ createdAt: 0, updatedAt: 2500 } as never)).toBe('3s')
  })
})

import { createElement } from 'react'
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { KitPdfExtract } from '../../features/shared/context/kitPdfImport'
import { ContextKitPdfPages, PDF_DEFAULT_PICKED_PAGES, defaultPickedPages } from './ContextKitPdfPages'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function extract(pageTotal: number, text = '品牌手册文字'): KitPdfExtract {
  return {
    name: '手册.pdf',
    pageCount: pageTotal + 5,
    failedPages: [],
    text,
    pages: Array.from({ length: pageTotal }, (_, index) => ({
      pageNumber: index + 1,
      blob: new Blob([String(index)], { type: 'image/jpeg' }),
      width: 100,
      height: 70,
    })),
  }
}

function mount(pdf: KitPdfExtract, onAdd = vi.fn()) {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(ContextKitPdfPages, { pdf, busy: false, onCancel: vi.fn(), onAdd }))
  })
  const find = (attr: string) => renderer.root.find((node) => node.props[attr] !== undefined && typeof node.type === 'string')
  return { renderer, onAdd, find }
}

describe('ContextKitPdfPages', () => {
  it('默认勾选前 8 页（与生成指南一次看图上限一致）', () => {
    expect(PDF_DEFAULT_PICKED_PAGES).toBe(8)
    expect([...defaultPickedPages(extract(12))]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('只交出勾选的页和（勾选时的）文字；全选 / 全不选；卸载时回收 blob 地址', () => {
    const createObjectURL = vi.fn(() => 'blob:x')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const { renderer, onAdd, find } = mount(extract(10))
    expect(createObjectURL).toHaveBeenCalledTimes(10)
    const pageButton = (n: number) =>
      renderer.root.find((node) => node.type === 'button' && node.props['data-context-pdf-page'] === n)
    act(() => pageButton(1).props.onClick())
    act(() => pageButton(10).props.onClick())
    act(() => find('data-context-pdf-add').props.onClick())
    const first = onAdd.mock.calls[0]![0]
    expect(first.pages.map((page: { pageNumber: number }) => page.pageNumber)).toEqual([2, 3, 4, 5, 6, 7, 8, 10])
    expect(first.text).toBe('品牌手册文字')

    act(() => find('data-context-pdf-select-all').props.onClick())
    act(() => find('data-context-pdf-select-all').props.onClick())
    const checkbox = renderer.root.find((node) => node.type === 'input' && node.props.type === 'checkbox')
    act(() => checkbox.props.onChange({ target: { checked: false } }))
    expect(find('data-context-pdf-add').props.disabled).toBe(true)

    act(() => renderer.unmount())
    expect(revokeObjectURL).toHaveBeenCalledTimes(10)
    vi.unstubAllGlobals()
  })

  it('超过页数上限与渲染失败的页如实提示；扫描件没有文字时说明', () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
    const pdf = { ...extract(2, ''), pageCount: 40, failedPages: [3] }
    const { renderer } = mount(pdf)
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('共 40 页，只读取前 20 页')
    expect(text).toContain('第 3 页渲染失败')
    expect(text).toContain('没有抽出文字')
    act(() => renderer.unmount())
    vi.unstubAllGlobals()
  })
})

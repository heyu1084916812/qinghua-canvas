import { createElement } from 'react'
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ContextKitGuideSection, type ContextKitGuideSectionProps } from './ContextKitGuideSection'
import type { KitGuideOutcome } from '../../features/shared/context/kitGuideGenerator'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function mount(props: Partial<ContextKitGuideSectionProps>) {
  const onGuideChange = vi.fn()
  const all: ContextKitGuideSectionProps = {
    label: '品牌设计指南',
    placeholder: 'p',
    guide: '',
    onGuideChange,
    canGenerate: true,
    offer: false,
    onDismissOffer: vi.fn(),
    generate: async () => ({ ok: true, text: '## 概述\nx', model: 'vision', limitations: [] }),
    ...props,
  }
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(ContextKitGuideSection, all))
  })
  const button = () => renderer.root.find((node) => node.props['data-context-kit-guide-generate'] !== undefined)
  return { renderer, onGuideChange, button, props: all }
}

const textOf = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON())

describe('ContextKitGuideSection', () => {
  it('空指南直接生成并把结果写进可编辑指南', async () => {
    const { button, onGuideChange, renderer } = mount({})
    await act(async () => {
      button().props.onClick()
    })
    expect(onGuideChange).toHaveBeenCalledWith('## 概述\nx')
    expect(textOf(renderer)).toContain('已用 vision 生成')
  })

  it('已有内容时先确认，取消则不调用生成', async () => {
    const generate = vi.fn(async (): Promise<KitGuideOutcome> => ({ ok: true, text: 'new', model: 'm', limitations: [] }))
    const { button, renderer, onGuideChange } = mount({ guide: '旧指南', generate })
    act(() => button().props.onClick())
    expect(generate).not.toHaveBeenCalled()
    expect(textOf(renderer)).toContain('生成结果会替换它')
    const cancel = renderer.root.findAll((node) => node.type === 'button' && node.children.includes('取消'))[0]!
    act(() => cancel.props.onClick())
    expect(textOf(renderer)).not.toContain('生成结果会替换它')
    act(() => button().props.onClick())
    const replace = renderer.root.find((node) => node.props['data-context-kit-guide-replace'] !== undefined)
    await act(async () => {
      replace.props.onClick()
    })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(onGuideChange).toHaveBeenCalledWith('new')
  })

  it('生成中可停止，信号被 abort，指南不改动', async () => {
    let seen: AbortSignal | null = null
    const generate = (signal: AbortSignal) => new Promise<KitGuideOutcome>((resolve) => {
      seen = signal
      signal.addEventListener('abort', () => resolve({ ok: false, message: '已取消生成', cancelled: true }))
    })
    const { button, renderer, onGuideChange } = mount({ generate })
    act(() => button().props.onClick())
    expect(button().props['data-context-kit-guide-generate']).toBe('stop')
    await act(async () => {
      button().props.onClick()
    })
    expect(seen!.aborted).toBe(true)
    expect(onGuideChange).not.toHaveBeenCalled()
    expect(textOf(renderer)).toContain('已停止生成')
    expect(button().props['data-context-kit-guide-generate']).toBe('start')
  })

  it('失败原因以 alert 显示', async () => {
    const { button, renderer } = mount({ generate: async () => ({ ok: false, message: '没有可用的看图对话模型' }) })
    await act(async () => {
      button().props.onClick()
    })
    const alert = renderer.root.find((node) => node.props.role === 'alert')
    expect(alert.children.join('')).toContain('没有可用的看图对话模型')
  })

  it('首次添加素材的提示可一键生成或关闭；没有素材时按钮禁用', async () => {
    const onDismissOffer = vi.fn()
    const { renderer } = mount({ offer: true, onDismissOffer })
    expect(renderer.root.findAll((node) => node.props['data-context-kit-guide-offer'] !== undefined)).toHaveLength(1)
    const quiet = renderer.root.findAll((node) => node.type === 'button' && node.children.includes('暂不'))[0]!
    act(() => quiet.props.onClick())
    expect(onDismissOffer).toHaveBeenCalled()
    const disabled = mount({ canGenerate: false })
    expect(disabled.button().props.disabled).toBe(true)
  })

  it('卸载时中止进行中的生成', () => {
    let seen: AbortSignal | null = null
    const { button, renderer } = mount({ generate: (signal) => { seen = signal; return new Promise(() => {}) } })
    act(() => button().props.onClick())
    act(() => renderer.unmount())
    expect(seen!.aborted).toBe(true)
  })
})

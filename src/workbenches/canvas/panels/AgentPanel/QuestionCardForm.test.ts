import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { QuestionCardForm } from './QuestionCardForm'

const questions = [
  { id: 'size', question: '尺寸？', options: ['3:4', '9:16'], multiple: false, allowFreeText: true },
  { id: 'refs', question: '参考怎么用？', options: ['管排版'], multiple: true, allowFreeText: false },
  { id: 'copy', question: '主标题？', options: [], multiple: false, allowFreeText: true },
]

function render(disabled = false): string {
  return renderToStaticMarkup(
    createElement(QuestionCardForm, { cardId: 'c1', questions, disabled, onSubmit: vi.fn() }),
  )
}

describe('QuestionCardForm', () => {
  it('每题一个分组：选项按钮可点（aria-pressed）、按需附自由输入', () => {
    const html = render()
    expect(html).toContain('data-agent-question-card="c1"')
    expect(html.match(/data-agent-question="/g)).toHaveLength(3)
    expect(html).toContain('data-agent-question-option="size:3:4"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('data-agent-question-input="size"')
    expect(html).not.toContain('data-agent-question-input="refs"')
    expect(html).toContain('data-agent-question-input="copy"')
    expect(html).toContain('（可多选）')
    expect(html).toContain('placeholder="直接写…"')
  })

  it('还没回答时提交按钮禁用；忙时选项也禁用', () => {
    expect(render()).toMatch(/<button type="submit"[^>]*disabled=""[^>]*data-agent-question-submit/)
    const busy = render(true)
    expect(busy).toMatch(/data-agent-question-option="size:3:4"/)
    expect(busy.match(/disabled=""/g)!.length).toBeGreaterThanOrEqual(4)
  })
})

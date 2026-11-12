import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { QuestionCardForm } from './QuestionCardForm'
import { QuestionCardSummary } from './QuestionCardSummary'
import { questionIndexInView, questionOptionLetter } from './questionCardView'

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

describe('QuestionCardForm（Lovart 样式 2026-11-12）', () => {
  it('头部「提问」+「‹ 1/N ›」翻页；所有题在同一个滚动区', () => {
    const html = render()
    expect(html).toContain('data-agent-question-card="c1"')
    expect(html).toContain('提问')
    expect(html).toMatch(/data-agent-question-page[^>]*>1(?:<!-- -->)?\/(?:<!-- -->)?3</)
    expect(html).toContain('data-agent-question-prev')
    expect(html).toContain('data-agent-question-next')
    expect(html.match(/data-agent-question-scroll/g)).toHaveLength(1)
    expect(html.match(/data-agent-question="/g)).toHaveLength(3)
  })

  it('选项是字母行，最后一个字母行是自由输入；「可多选」只标一次', () => {
    const html = render()
    expect(html).toContain('data-agent-question-option="size:3:4"')
    expect(html).toContain('aria-pressed="false"')
    // size: A 3:4 / B 9:16 / C 其他…
    expect(html).toMatch(/data-agent-question-option="size:3:4"><span[^>]*>A<\/span>/)
    expect(html).toMatch(/>C<\/span><input[^>]*placeholder="其他…"[^>]*data-agent-question-input="size"/)
    expect(html).not.toContain('data-agent-question-input="refs"')
    expect(html).toMatch(/>A<\/span><input[^>]*placeholder="直接写…"[^>]*data-agent-question-input="copy"/)
    expect(html.match(/可多选/g)).toHaveLength(1)
    expect(html).not.toContain('（可多选）')
    expect(html).not.toContain('或直接写')
  })

  it('底部「跳过」+「提交 ↵」：未答时提交禁用；忙时全部禁用', () => {
    const html = render()
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*data-agent-question-submit/)
    expect(html).toContain('↵')
    expect(html).toMatch(/<button type="button"[^>]*data-agent-question-skip[^>]*>跳过</)
    expect(html).not.toMatch(/disabled=""[^>]*data-agent-question-skip/)
    const busy = render(true)
    expect(busy).toMatch(/disabled=""[^>]*data-agent-question-skip/)
    expect(busy.match(/disabled=""/g)!.length).toBeGreaterThanOrEqual(6)
  })

  it('字母序与当前可见题的计算', () => {
    expect(['A', 'B', 'G'].map((l, i) => questionOptionLetter([0, 1, 6][i]!) === l)).toEqual([true, true, true])
    expect(questionIndexInView([0, 200, 420], 0, false)).toBe(0)
    expect(questionIndexInView([0, 200, 420], 190, false)).toBe(1)
    expect(questionIndexInView([0, 200, 420], 300, true)).toBe(2)
    expect(questionIndexInView([], 0, false)).toBe(0)
    // 下一题顶边进入可视区上 1/3 就算翻到它
    expect(questionIndexInView([0, 200, 420], 100, false, 110)).toBe(1)
  })
})

describe('QuestionCardSummary', () => {
  it('已回答折成一行「已回答 N 题」，默认收起', () => {
    const html = renderToStaticMarkup(createElement(QuestionCardSummary, {
      summary: { skipped: false, answeredCount: 2, rows: [{ question: '尺寸？', answer: '3:4' }] },
    }))
    expect(html).toContain('data-agent-question-summary="answered"')
    expect(html).toContain('已回答 2 题')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('data-agent-question-summary-list')
  })

  it('跳过显示「已跳过」', () => {
    const html = renderToStaticMarkup(createElement(QuestionCardSummary, {
      summary: { skipped: true, answeredCount: 0, rows: [{ question: '尺寸？', answer: '未回答' }] },
    }))
    expect(html).toContain('data-agent-question-summary="skipped"')
    expect(html).toContain('已跳过')
  })
})

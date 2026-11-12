import { useState } from 'react'
import type { QuestionCardAnswerSummary } from '../../../../domain/agent/questionCardReply'
import { IconChevronRight } from '../../toolbar/icons'
import styles from './QuestionCardSummary.module.css'

/** 头部 / 摘要里的「?」图标（圆角方框问号，与 Lovart 提问卡一致）。 */
export function QuestionHelpIcon() {
  return (
    <svg
      className={styles.headIcon}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.6-2.4 2-2.4 3.4" />
      <path d="M12 16.9h.01" />
    </svg>
  )
}

/**
 * 已提交 / 已跳过的问题卡：折成一行「已回答 N 题 ›」/「已跳过 ›」，点开看每题的回答。
 * 替代原来那条整段「问题卡回答：1. … → …」的用户气泡。
 */
export function QuestionCardSummary({
  summary,
}: {
  summary: QuestionCardAnswerSummary
}) {
  const [open, setOpen] = useState(false)
  const label = summary.skipped ? '已跳过' : `已回答 ${summary.answeredCount} 题`
  return (
    <div
      className={styles.summary}
      data-agent-question-summary={summary.skipped ? 'skipped' : 'answered'}
    >
      <button
        type="button"
        className={styles.summaryToggle}
        aria-expanded={open}
        data-agent-question-summary-toggle
        onClick={() => setOpen((value) => !value)}
      >
        <QuestionHelpIcon />
        <span>{label}</span>
        <span
          className={open ? `${styles.summaryChevron} ${styles.summaryChevronOpen}` : styles.summaryChevron}
          aria-hidden="true"
        >
          <IconChevronRight size={12} />
        </span>
      </button>
      {open ? (
        <ul className={styles.summaryList} data-agent-question-summary-list>
          {summary.skipped ? (
            <li className={styles.summaryNote}>没有作答，Agent 按自己的判断继续</li>
          ) : null}
          {summary.rows.map((row, index) => (
            <li key={index} className={styles.summaryRow}>
              <span className={styles.summaryQuestion}>{row.question}</span>
              <span
                className={
                  row.answer === '未回答'
                    ? `${styles.summaryAnswer} ${styles.summaryAnswerEmpty}`
                    : styles.summaryAnswer
                }
              >
                {row.answer}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

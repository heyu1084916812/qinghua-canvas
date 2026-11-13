import { useState } from 'react'
import type { QuestionCardAnswerSummary } from '../../../../domain/agent/questionCardReply'
import { IconChevronRight } from '../../toolbar/icons'
import { CircleHelp, Icon } from '../../../../ui/icon'
import styles from './QuestionCardSummary.module.css'

/** 头部 / 摘要里的「?」图标（第 5 批起几何来自 Lucide）。 */
export function QuestionHelpIcon() {
  return <Icon className={styles.headIcon} icon={CircleHelp} size="sm" />
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

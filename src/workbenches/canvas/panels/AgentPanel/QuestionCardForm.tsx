import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  formatQuestionAnswers,
  formatQuestionSkip,
  questionCardAnswerable,
  setQuestionFreeText,
  toggleQuestionOption,
  type AgentQuestion,
  type AgentQuestionAnswer,
} from '../../../../domain/agent/questionCard'
import { QuestionHelpIcon } from './QuestionCardSummary'
import { questionIndexInView, questionOptionLetter } from './questionCardView'
import { IconChevronLeft, IconChevronRight } from '../../toolbar/icons'
import baseStyles from './AgentPanel.module.css'
import cardStyles from './QuestionCardForm.module.css'

const styles = { ...baseStyles, ...cardStyles }

/**
 * 问题卡（askQuestions，Lovart 样式，用户 2026-11-12）：
 * - 紧凑卡片、固定最大高度，所有题目纵向排在同一滚动区；头部「提问」+「‹ 1/N ›」，
 *   箭头滚到上 / 下一题，滚动时页码跟随当前可见的题；
 * - 选项是 A/B/C 字母行（整行可点、选中高亮；多选题标一次「可多选」），最后一个字母行就是自由输入；
 * - 底部「跳过」（不答，按 Agent 推断继续）+「提交 ↵」（至少答一题才可提交，可部分作答；Enter 提交）。
 * 提交 / 跳过都整理成一条普通用户消息发回（formatQuestionAnswers / formatQuestionSkip）。
 */
export function QuestionCardForm({
  cardId,
  questions,
  disabled = false,
  onSubmit,
}: {
  cardId: string
  questions: readonly AgentQuestion[]
  disabled?: boolean
  onSubmit(text: string): void
}) {
  const [answers, setAnswers] = useState<AgentQuestionAnswer[]>([])
  const [current, setCurrent] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const questionRefs = useRef<(HTMLFieldSetElement | null)[]>([])
  const answerable = questionCardAnswerable(questions, answers)
  const total = questions.length

  const submit = () => {
    if (disabled || !answerable) return
    onSubmit(formatQuestionAnswers(questions, answers))
  }
  const skip = () => {
    if (disabled) return
    onSubmit(formatQuestionSkip(questions))
  }

  const syncCurrent = useCallback(() => {
    const body = scrollRef.current
    if (!body) return
    const offsets = questionRefs.current.map((node) => node?.offsetTop ?? 0)
    const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 2 && body.scrollTop > 0
    setCurrent(questionIndexInView(offsets, body.scrollTop, atBottom, Math.max(24, body.clientHeight / 3)))
  }, [])

  useEffect(() => {
    syncCurrent()
  }, [syncCurrent, total])

  const goTo = (index: number) => {
    const target = Math.max(0, Math.min(total - 1, index))
    const body = scrollRef.current
    const node = questionRefs.current[target]
    if (body && node) {
      body.scrollTo({ top: node.offsetTop, behavior: 'smooth' })
    }
    setCurrent(target)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    // 「跳过」与翻页按钮保持按钮自己的 Enter 行为；选项行与输入框里按 Enter = 提交
    const target = event.target as HTMLElement
    if (target.tagName === 'BUTTON' && !target.hasAttribute('data-agent-question-option')) return
    event.preventDefault()
    submit()
  }

  return (
    <form
      className={styles.card}
      data-agent-question-card={cardId}
      aria-label="提问"
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className={styles.head}>
        <span className={styles.headTitle}>
          <QuestionHelpIcon />
          提问
        </span>
        {total > 1 ? (
          <span className={styles.pager} data-agent-question-pager>
            <button
              type="button"
              className={styles.pagerButton}
              aria-label="上一题"
              title="上一题"
              disabled={current <= 0}
              data-agent-question-prev
              onClick={() => goTo(current - 1)}
            >
              <IconChevronLeft size={14} />
            </button>
            <span className={styles.pagerText} aria-live="polite" data-agent-question-page>
              {current + 1}/{total}
            </span>
            <button
              type="button"
              className={styles.pagerButton}
              aria-label="下一题"
              title="下一题"
              disabled={current >= total - 1}
              data-agent-question-next
              onClick={() => goTo(current + 1)}
            >
              <IconChevronRight size={14} />
            </button>
          </span>
        ) : null}
      </div>
      <div
        ref={scrollRef}
        className={styles.body}
        data-agent-question-scroll
        onScroll={syncCurrent}
      >
        {questions.map((question, index) => {
          const answer = answers.find((row) => row.questionId === question.id)
          const freeText = answer?.freeText ?? ''
          const freeLetter = questionOptionLetter(question.options.length)
          return (
            <fieldset
              key={question.id}
              ref={(node) => {
                questionRefs.current[index] = node
              }}
              className={styles.question}
              data-agent-question={question.id}
            >
              <legend className={styles.questionTitle}>
                {question.question}
                {question.multiple ? (
                  <span className={styles.questionHint}>可多选</span>
                ) : null}
              </legend>
              <div className={styles.options} role="group" aria-label={question.question}>
                {question.options.map((option, optionIndex) => {
                  const pressed = answer?.selected.includes(option) === true
                  return (
                    <button
                      key={option}
                      type="button"
                      className={styles.option}
                      aria-pressed={pressed}
                      disabled={disabled}
                      data-agent-question-option={`${question.id}:${option}`}
                      onClick={() =>
                        setAnswers((rows) => toggleQuestionOption(rows, question, option))
                      }
                    >
                      <span className={styles.letter} aria-hidden="true">
                        {questionOptionLetter(optionIndex)}
                      </span>
                      <span className={styles.optionText}>{option}</span>
                    </button>
                  )
                })}
                {question.allowFreeText ? (
                  <label
                    className={`${styles.option} ${styles.freeRow}`}
                    data-filled={freeText.trim() ? 'true' : 'false'}
                    data-disabled={disabled ? 'true' : undefined}
                  >
                    <span className={styles.letter} aria-hidden="true">
                      {freeLetter}
                    </span>
                    <input
                      className={styles.freeInput}
                      type="text"
                      value={freeText}
                      disabled={disabled}
                      placeholder={question.options.length > 0 ? '其他…' : '直接写…'}
                      aria-label={`${question.question}（自由输入）`}
                      data-agent-question-input={question.id}
                      onChange={(event) => {
                        const value = event.target.value
                        setAnswers((rows) => setQuestionFreeText(rows, question, value))
                      }}
                    />
                  </label>
                ) : null}
              </div>
            </fieldset>
          )
        })}
      </div>
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.skip}
          disabled={disabled}
          data-agent-question-skip
          onClick={skip}
        >
          跳过
        </button>
        <button
          type="submit"
          className={styles.submit}
          disabled={disabled || !answerable}
          data-agent-question-submit
        >
          提交
          <span className={styles.enterHint} aria-hidden="true">↵</span>
        </button>
      </div>
    </form>
  )
}

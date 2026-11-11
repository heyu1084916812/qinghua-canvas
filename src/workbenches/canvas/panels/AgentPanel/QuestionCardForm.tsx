import { useState } from 'react'
import {
  formatQuestionAnswers,
  questionCardAnswerable,
  setQuestionFreeText,
  toggleQuestionOption,
  type AgentQuestion,
  type AgentQuestionAnswer,
} from '../../../../domain/agent/questionCard'
import baseStyles from './AgentPanel.module.css'
import cardStyles from './QuestionCardForm.module.css'

const styles = { ...baseStyles, ...cardStyles }

/**
 * 问题卡（askQuestions）：多题，每题候选项可点（单选 / 多选）+ 自由输入，一个提交按钮。
 * 提交后把回答整理成一条普通用户消息发回（formatQuestionAnswers），Agent 在下一回合接着做。
 * 视觉沿用步骤卡 / 确认卡的令牌：描边 `--stroke`、按钮 `.primary`、字号 `--fs-chip`/`--fs-label`。
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
  const answerable = questionCardAnswerable(questions, answers)
  const submit = () => {
    if (disabled || !answerable) return
    onSubmit(formatQuestionAnswers(questions, answers))
  }
  return (
    <form
      className={styles.card}
      data-agent-question-card={cardId}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {questions.map((question, index) => {
        const answer = answers.find((row) => row.questionId === question.id)
        const inputId = `agent-question-${cardId}-${question.id}`
        return (
          <fieldset
            key={question.id}
            className={styles.question}
            data-agent-question={question.id}
          >
            <legend className={styles.questionTitle}>
              {index + 1}. {question.question}
              {question.multiple ? (
                <span className={styles.questionHint}>（可多选）</span>
              ) : null}
            </legend>
            {question.options.length > 0 ? (
              <div className={styles.options}>
                {question.options.map((option) => {
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
                        setAnswers((current) =>
                          toggleQuestionOption(current, question, option),
                        )
                      }
                    >
                      {option}
                    </button>
                  )
                })}
              </div>
            ) : null}
            {question.allowFreeText ? (
              <input
                id={inputId}
                className={styles.input}
                type="text"
                value={answer?.freeText ?? ''}
                disabled={disabled}
                placeholder={question.options.length > 0 ? '或直接写…' : '直接写…'}
                aria-label={`${question.question}（自由输入）`}
                data-agent-question-input={question.id}
                onChange={(event) => {
                  const value = event.target.value
                  setAnswers((current) =>
                    setQuestionFreeText(current, question, value),
                  )
                }}
              />
            ) : null}
          </fieldset>
        )
      })}
      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.primary}
          disabled={disabled || !answerable}
          data-agent-question-submit
        >
          提交回答
        </button>
      </div>
    </form>
  )
}

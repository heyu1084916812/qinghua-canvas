import { useEffect, useRef, useState } from 'react'
import type { KitGuideOutcome } from '../../features/shared/context/kitGuideGenerator'
import baseStyles from './ContextKitsDialog.module.css'
import editorStyles from './ContextKitsEditor.module.css'
import importStyles from './ContextKitsImport.module.css'

const styles = { ...baseStyles, ...editorStyles, ...importStyles } as Record<string, string>

export interface ContextKitGuideSectionProps {
  label: string
  placeholder: string
  guide: string
  onGuideChange(next: string): void
  /** 是否有可用于生成的素材（图片 / 颜色 / 资料文字）。 */
  canGenerate: boolean
  /** 首次添加素材且指南为空时，在指南上方主动提示一次。 */
  offer: boolean
  onDismissOffer(): void
  /** 生成时会一并参考的资料（网页 / PDF 文字）标签。 */
  sourceLabels?: readonly string[]
  generate(signal: AbortSignal): Promise<KitGuideOutcome>
}

type Phase = 'idle' | 'confirm' | 'running'

/**
 * 设计指南区：手写 textarea + 「根据素材生成指南」（2026-11-12，对齐 Lovart 品牌套件）。
 *
 * - 生成结果写进同一个可编辑 textarea；已有内容时必须先确认「替换」，绝不静默覆盖。
 * - 生成中按钮变「停止生成」，AbortController 一路透传到渠道请求；卸载时也 abort。
 * - 失败原因以 role=alert 显示（已在生成器里去掉疑似密钥）。
 */
export function ContextKitGuideSection({
  label,
  placeholder,
  guide,
  onGuideChange,
  canGenerate,
  offer,
  onDismissOffer,
  sourceLabels = [],
  generate,
}: ContextKitGuideSectionProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => controllerRef.current?.abort()
  }, [])

  const run = async () => {
    const controller = new AbortController()
    controllerRef.current = controller
    setPhase('running')
    setError('')
    setNote('')
    onDismissOffer()
    try {
      const outcome = await generate(controller.signal)
      if (controllerRef.current !== controller) return
      if (outcome.ok) {
        onGuideChange(outcome.text)
        setNote(
          [`已用 ${outcome.model} 生成，可直接修改`, ...outcome.limitations].join('；'),
        )
      } else if (outcome.cancelled) {
        setNote('已停止生成，指南未改动')
      } else {
        setError(outcome.message)
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setPhase('idle')
      }
    }
  }

  const start = () => {
    if (phase === 'running') {
      controllerRef.current?.abort()
      return
    }
    if (guide.trim()) {
      setPhase('confirm')
      return
    }
    void run()
  }

  return (
    <section className={styles.section} data-context-kit-guide-section>
      <div className={styles.sectionHead}>
        <h3>{label}</h3>
        <button
          type="button"
          className={styles.addButton}
          disabled={phase !== 'running' && !canGenerate}
          aria-busy={phase === 'running'}
          title={canGenerate ? undefined : '先添加 Logo、参考图、颜色或导入品牌手册'}
          data-context-kit-guide-generate={phase === 'running' ? 'stop' : 'start'}
          onClick={start}
        >
          {phase === 'running' ? (
            <>
              <span className={styles.guideSpinner} aria-hidden /> 停止生成
            </>
          ) : (
            <>
              <span aria-hidden>✦</span> 根据素材生成指南
            </>
          )}
        </button>
      </div>
      {offer && phase === 'idle' && !guide.trim() ? (
        <div className={styles.guideNotice} data-context-kit-guide-offer>
          <span>已添加素材，要根据素材自动生成设计指南吗？</span>
          <button type="button" className={styles.guideNoticeAction} onClick={() => void run()}>
            生成
          </button>
          <button type="button" className={styles.guideNoticeQuiet} onClick={onDismissOffer}>
            暂不
          </button>
        </div>
      ) : null}
      {phase === 'confirm' ? (
        <div className={styles.guideNotice} role="alertdialog" aria-label="替换现有指南">
          <span>当前指南已有内容，生成结果会替换它。</span>
          <button
            type="button"
            className={styles.guideNoticeAction}
            data-context-kit-guide-replace
            onClick={() => void run()}
          >
            替换
          </button>
          <button
            type="button"
            className={styles.guideNoticeQuiet}
            onClick={() => setPhase('idle')}
          >
            取消
          </button>
        </div>
      ) : null}
      <textarea
        className={styles.guide}
        value={guide}
        placeholder={phase === 'running' ? '正在读取素材并生成设计指南…' : placeholder}
        readOnly={phase === 'running'}
        data-context-kit-guide
        onChange={(event) => onGuideChange(event.target.value)}
      />
      {sourceLabels.length > 0 ? (
        <p className={styles.sourceNote} data-context-kit-guide-sources>
          生成时会参考：{sourceLabels.join('、')}
        </p>
      ) : null}
      {error ? (
        <p className={styles.guideError} role="alert" data-context-kit-guide-error>
          {error}
        </p>
      ) : note ? (
        <p className={styles.guideNote} role="status">
          {note}
        </p>
      ) : null}
    </section>
  )
}

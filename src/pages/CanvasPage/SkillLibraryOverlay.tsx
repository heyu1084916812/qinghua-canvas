import { useCallback, useEffect, useId, useRef } from 'react'
import { sendSkillToAgent } from '../../features/canvas/agentSkillHandoff'
import { noticeA11y } from '../../domain/ui/notice'
import { SkillLibraryView } from '../SkillsPage/SkillLibraryView'
import type { AgentSkillTarget } from '../SkillsPage/skillAgentResolve'
import { useSkillLibraryState } from '../SkillsPage/useSkillLibraryState'
import pageStyles from '../SkillsPage/SkillsPage.module.css'
import { trapTabKey } from './skillLibraryFocus'
import { Icon, X } from '../../ui/icon'
import styles from './SkillLibraryOverlay.module.css'

/**
 * 画布上的技能库浮层（用户 2026-11-12）：Agent 输入框的技能按钮打开，居中在画布区域
 * （不铺满窗口、不挤进 Agent 面板）。内容与技能页同一份 `SkillLibraryView`；
 * 「使用 / 添加到 Agent」把技能投递给本项目的 Agent，落成输入框里的技能 chip，可连续加多个。
 */
export function SkillLibraryOverlay({
  projectId,
  onClose,
  onOpenSkillsPage,
}: {
  projectId: string
  onClose: () => void
  /** 新建技能 / 功能预设词仍在完整的技能页里做 */
  onOpenSkillsPage: () => void
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const addToAgent = useCallback(
    (skill: AgentSkillTarget) => {
      sendSkillToAgent(projectId, skill.id)
      return `已把「${skill.name}」加入 Agent 输入框，可继续添加。`
    },
    [projectId],
  )
  const library = useSkillLibraryState(addToAgent)
  const detailOpen = library.detail !== null
  const detailOpenRef = useRef(detailOpen)
  detailOpenRef.current = detailOpen

  /** 详情关掉后把焦点还给打开它的那张卡（详情自带的关闭会让焦点落到 body） */
  const detailId = library.detail?.skill.id ?? null
  useEffect(() => {
    if (!detailId) return
    return () => {
      const dialog = dialogRef.current
      if (!dialog?.isConnected) return
      const card = Array.from(dialog.querySelectorAll<HTMLElement>('[data-skill-item]')).find(
        (el) => el.dataset.skillItem === detailId,
      )
      ;(card ?? dialog).focus()
    }
  }, [detailId])

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const search = dialog?.querySelector<HTMLElement>('[data-skills-search]')
    ;(search ?? dialog)?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || detailOpenRef.current) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (previous?.isConnected) previous.focus()
    }
  }, [onClose])

  return (
    <div className={styles.layer} data-skill-library-overlay>
      <div
        className={styles.backdrop}
        data-skill-library-backdrop
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      />
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-skill-library-dialog
        onKeyDown={(event) => {
          const scope = detailOpen
            ? event.currentTarget.querySelector<HTMLElement>('[data-skill-detail-scrim]') ?? event.currentTarget
            : event.currentTarget
          trapTabKey(event, scope)
        }}
      >
        <header className={styles.head}>
          <h2 id={titleId} className={styles.title}>技能库</h2>
          <span className={styles.hint}>点「使用」把技能加入当前 Agent 对话，发送时按技能要求生成</span>
          <button
            type="button"
            className={styles.close}
            aria-label="关闭技能库"
            title="关闭（Esc）"
            data-skill-library-close
            onClick={onClose}
          >
            <Icon icon={X} size="sm" />
          </button>
        </header>
        {library.notice ? (
          <div
            className={library.notice.kind === 'ok' ? pageStyles.noticeOk : pageStyles.noticeErr}
            data-skill-library-notice={library.notice.kind}
            {...noticeA11y(library.notice.kind === 'error' ? 'error' : 'info')}
          >
            {library.notice.text}
          </div>
        ) : null}
        <div className={styles.body}>
          <SkillLibraryView
            state={library}
            contained
            onNew={onOpenSkillsPage}
            onOpenPresets={onOpenSkillsPage}
          />
        </div>
      </section>
    </div>
  )
}

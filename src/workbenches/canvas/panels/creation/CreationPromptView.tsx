import type { MutableRefObject } from 'react'
import {
  MentionEditor,
  type MentionEditorHandle,
  type MentionRef,
} from '../../text/MentionEditor'
import type { MentionCandidate } from '../../text/mentionValue'
import {
  IconChevronDown,
  IconChevronUp,
  IconPrompt,
} from '../../toolbar/icons'
import { MentionThumb, MentionThumbProbe } from './CreationAssetViews'
import { creationStyles as styles } from './creationStyles'

interface MentionPosition {
  left: number
  top: number
}

interface PromptToggle {
  visible: boolean
  title: string
}

interface CreationPromptViewProps {
  promptExpanded: boolean
  promptOverflow: boolean
  linkedPromptCount: number
  promptBoxRef: MutableRefObject<HTMLDivElement | null>
  promptEditorRef: MutableRefObject<MentionEditorHandle | null>
  promptValue: string
  label: string
  placeholder: string
  mentionOpen: boolean
  mentionPos: MentionPosition | null
  mentionCandidates: MentionCandidate[]
  mentionHashOf: Map<string, string>
  mentionThumbRef: MutableRefObject<Map<string, string>>
  mentionThumbVersion: number
  mentionThumbOf: (id: string) => string | null
  promptToggle?: PromptToggle | null
  promptMode: boolean
  promptLength: number
  toolError?: string | null
  onToggleExpand: () => void
  onPromptValueChange: (value: string) => void
  onMentionTrigger: () => void
  onChipClick: (ref: MentionRef) => void
  onPromptBlur: () => void
  onInsertMention: (candidate: MentionCandidate) => void
  onMentionThumbLoaded: () => void
  onTogglePrompt: () => void
}

export function CreationPromptView({
  promptExpanded,
  promptOverflow,
  linkedPromptCount,
  promptBoxRef,
  promptEditorRef,
  promptValue,
  label,
  placeholder,
  mentionOpen,
  mentionPos,
  mentionCandidates,
  mentionHashOf,
  mentionThumbRef,
  mentionThumbVersion,
  mentionThumbOf,
  promptToggle,
  promptMode,
  promptLength,
  toolError,
  onToggleExpand,
  onPromptValueChange,
  onMentionTrigger,
  onChipClick,
  onPromptBlur,
  onInsertMention,
  onMentionThumbLoaded,
  onTogglePrompt,
}: CreationPromptViewProps) {
  return (
    <section
      className={`${styles.section} ${styles.promptSection} ${styles.promptSectionComfort}`}
      data-panel-part="prompt"
      data-panel-prompt-comfort="fixed"
    >
      <div className={styles.promptRow}>
        {linkedPromptCount > 0 && (
          <div className={styles.promptHead}>
            <span className={styles.linkedRow} data-panel-linked-prompt>
              <span className={styles.linked}>
                <span className={styles.linkedIcon} aria-hidden="true">
                  <IconPrompt size={14} />
                </span>
                <span>提示词</span>
              </span>
              <span className={styles.linkedMeta}>已链接 {linkedPromptCount} 个</span>
            </span>
          </div>
        )}
        <div
          className={`${styles.promptBox} ${styles.promptBoxComfort}`}
          ref={promptBoxRef}
          data-panel-prompt-box
        >
          {promptExpanded || promptOverflow ? (
            <button
              type="button"
              className={styles.promptExpand}
              data-panel-prompt-expand
              aria-label={promptExpanded ? '收起编辑区' : '展开编辑区'}
              aria-pressed={promptExpanded}
              title={promptExpanded ? '收起编辑区' : '展开编辑区'}
              onClick={onToggleExpand}
            >
              {promptExpanded ? <IconChevronDown size={14} /> : <IconChevronUp size={14} />}
            </button>
          ) : null}
          <MentionEditor
            ref={promptEditorRef}
            className={`${styles.prompt} ${styles.promptEditor} ${styles.promptEditorComfort}`}
            anchorAttr={{ 'data-panel-prompt': '' }}
            label={label}
            autoGrow={false}
            value={promptValue}
            placeholder={placeholder}
            onChange={onPromptValueChange}
            onMentionTrigger={onMentionTrigger}
            onChipClick={onChipClick}
            thumbOf={mentionThumbOf}
            thumbVersion={mentionThumbVersion}
            onBlur={onPromptBlur}
          />
          {mentionOpen && (
            <div
              className={styles.mentionMenu}
              data-panel-mention-menu
              style={mentionPos ? { left: mentionPos.left, top: mentionPos.top } : undefined}
            >
              <div className={styles.mentionHint}>引用本节点上游的素材</div>
              {mentionCandidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className={styles.mentionItem}
                  data-panel-mention={candidate.id}
                  onClick={() => onInsertMention(candidate)}
                >
                  <MentionThumb hash={mentionHashOf.get(candidate.id)} />
                  <span className={styles.mentionName} title={candidate.label}>
                    {candidate.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {mentionCandidates.map((candidate) => (
          <MentionThumbProbe
            key={candidate.id}
            id={candidate.id}
            hash={mentionHashOf.get(candidate.id)}
            sink={mentionThumbRef}
            onLoaded={onMentionThumbLoaded}
          />
        ))}
        {promptToggle && (
          <button
            type="button"
            className={
              promptToggle.visible
                ? styles.eyeBtn
                : `${styles.eyeBtn} ${styles.eyeOff}`
            }
            title={promptToggle.title}
            aria-label={promptToggle.title}
            aria-pressed={promptToggle.visible}
            onClick={onTogglePrompt}
          >
            {promptToggle.visible ? '👁' : '⃠'}
          </button>
        )}
      </div>
      {promptMode && (
        <div className={styles.toolRow} data-panel-prompt-tools>
          <span className={styles.toolCount} data-panel-prompt-count>
            {promptLength} 字
          </span>
        </div>
      )}
      {promptMode && toolError && (
        <div className={styles.toolError} data-panel-prompt-tool-error>
          {toolError}
        </div>
      )}
    </section>
  )
}

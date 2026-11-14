import type { PanelModel } from '../panelModel'
import { IconPreset, IconSpinner, IconStop } from '../../toolbar/icons'
import { PresetMenu, PresetOptions } from '../PresetMenu'
import { ArrowUp, Icon } from '../../../../ui/icon'
import { creationStyles as styles } from './creationStyles'

function RunArrow() {
  return <Icon icon={ArrowUp} px={18} className={styles.runArrow} />
}

interface CreationRunActionsViewProps {
  /**
   * 隐藏「预设」入口（工作流模式）。
   *
   * 预设是 **API 生图**那套「分镜叙事 / 空间与机体 / 设定图」的风格配方，
   * 工作流的参数由条目自己决定，摆着一个点不出东西的按钮只会让人以为漏了功能。
   */
  hidePreset?: boolean
  promptMode: boolean
  activePreset: { id: string } | undefined
  presetOptionsAvailable: boolean
  presetOpen: boolean
  presetOptionsOpen: boolean
  model: PanelModel
  emotionOn: boolean
  running: boolean
  busyGlobal: boolean
  runDisabled: boolean
  runLabel: string
  runTitle: string
  blockedReason: string | null
  disabled: boolean
  error: string | null
  onTogglePreset: () => void
  onPickPreset: (id: string) => void
  onPickEmotion: () => void
  onPickPresetOption: (group: string, choice: string) => void
  onRunAction: () => void
}

export function CreationRunActionsView({
  hidePreset = false,
  promptMode,
  activePreset,
  presetOptionsAvailable,
  presetOpen,
  presetOptionsOpen,
  model,
  emotionOn,
  running,
  busyGlobal,
  runDisabled,
  runLabel,
  runTitle,
  blockedReason,
  disabled,
  error,
  onTogglePreset,
  onPickPreset,
  onPickEmotion,
  onPickPresetOption,
  onRunAction,
}: CreationRunActionsViewProps) {
  return (
    <>
      {!promptMode && !hidePreset && (
        <span className={styles.presetAnchor}>
          <button
            type="button"
            className={
              activePreset
                ? `${styles.presetBtn} ${styles.presetBtnOn}`
                : styles.presetBtn
            }
            data-panel-preset
            aria-label="预设"
            aria-haspopup="menu"
            aria-expanded={presetOpen}
            title="预设：分镜叙事 / 空间与机位 / 设定图 / 质感调节"
            onClick={onTogglePreset}
          >
            <IconPreset size={28} />
          </button>
          {presetOpen && (
            <PresetMenu
              activeId={model.preset}
              emotionOn={emotionOn}
              onPick={onPickPreset}
              onPickEmotion={onPickEmotion}
            />
          )}
          {presetOptionsOpen && activePreset && presetOptionsAvailable && (
            <PresetOptions
              presetId={activePreset.id}
              options={model.presetOptions}
              onPick={onPickPresetOption}
            />
          )}
        </span>
      )}
      <button
        className={[
          styles.run,
          running ? styles.runCancel : '',
          busyGlobal ? styles.runBusy : '',
        ]
          .filter(Boolean)
          .join(' ')}
        disabled={runDisabled}
        data-panel-run
        data-panel-run-blocked={blockedReason ?? undefined}
        title={runTitle}
        aria-label={runLabel}
        onClick={onRunAction}
      >
        {running ? (
          <IconStop size={18} />
        ) : busyGlobal ? (
          <IconSpinner size={20} />
        ) : (
          <RunArrow />
        )}
      </button>
      {disabled && (
        <span className={styles.disabledNotice} data-panel-disabled>
          节点已禁用：不参与执行，它的内容（含已生成的图）也不会作为上游输入
        </span>
      )}
      {error && <span className={styles.error}>{error}</span>}
    </>
  )
}

import type { ParamSection } from '../ParamPicker'
import { ParamPicker } from '../ParamPicker'
import {
  isAutoRatio,
  type VideoModeId,
} from '../../../../domain/canvas/layout/videoParams'
import { creationStyles as styles } from './creationStyles'
import type { deriveCreationQualityParams } from './creationQualityParams'

interface CreationParameterControlsProps {
  noPlatform: boolean
  platformGap: string
  categoryLabel: string
  modelLabel: string
  modelOptions: React.ComponentProps<typeof ParamPicker>['options']
  modelValue: string
  modelOpen: boolean
  videoModeLabel: string
  promptMode: boolean
  videoMode: boolean
  quality: ReturnType<typeof deriveCreationQualityParams>
  paramSections: ParamSection[]
  isMj: boolean
  mjSections: ParamSection[]
  openPicker: string | null
  onOpenSettings: () => void
  onTogglePicker: (key: string) => void
  onClosePicker: () => void
  onSelectModel: (value: string) => void
  onSelectVideoMode: (value: VideoModeId) => void
  onSelectRatio: (value: string) => void
  onSelectSize: (value: string) => void
  onDurationChange: (value: string) => void
  onSelectGenerateAudio: (value: string) => void
  onSelectCount: (value: string) => void
}

export function CreationParameterControls({
  noPlatform,
  platformGap,
  categoryLabel,
  modelLabel,
  modelOptions,
  modelValue,
  modelOpen,
  videoModeLabel,
  promptMode,
  videoMode,
  quality,
  paramSections,
  isMj,
  mjSections,
  openPicker,
  onOpenSettings,
  onTogglePicker,
  onClosePicker,
  onSelectModel,
  onSelectVideoMode,
  onSelectRatio,
  onSelectSize,
  onDurationChange,
  onSelectGenerateAudio,
  onSelectCount,
}: CreationParameterControlsProps) {
  const {
    ratios,
    shownRatio,
    count,
    countChoices,
    maxCount,
    paramsLabel,
    sizeChoices,
    sizeValue,
    sizeLabel,
    minSec,
    maxSec,
    duration,
    showDuration,
    videoModeOptions,
    videoModeValue,
    showVideoMode,
    videoCounts,
    videoCount,
    showVideoCount,
    showGenerateAudio,
    generateAudio,
  } = quality

  return (
    <>
      {noPlatform && (
        <button
          type="button"
          className={styles.setupHint}
          data-panel-setup-hint={platformGap}
          onClick={onOpenSettings}
        >
          <span>{platformGap}</span>
          <span className={styles.setupHintGo}>去后台设置 →</span>
        </button>
      )}
      <ParamPicker
        name="model"
        ariaLabel={categoryLabel}
        label={modelLabel}
        options={modelOptions}
        value={modelValue}
        variant="list"
        open={modelOpen}
        onToggle={() => onTogglePicker('model')}
        onClose={onClosePicker}
        onSelect={onSelectModel}
        disabled={false}
      />
      {!promptMode && (
        <span className={styles.paramDivider} data-param-divider aria-hidden="true" />
      )}
      {!promptMode && (
        <>
          {videoMode ? (
            <>
              {showVideoMode && (
                <ParamPicker
                  name="videoMode"
                  ariaLabel="视频生成模式"
                  label={videoModeLabel}
                  options={videoModeOptions}
                  value={videoModeValue}
                  variant="list"
                  open={openPicker === 'videoMode'}
                  onToggle={() => onTogglePicker('videoMode')}
                  onClose={onClosePicker}
                  onSelect={(value) => onSelectVideoMode(value as VideoModeId)}
                />
              )}
              <ParamPicker
                name="ratio"
                ariaLabel="画面比例"
                label={shownRatio || '比例'}
                options={ratios.map((ratio) => ({
                  value: ratio,
                  label: isAutoRatio(ratio) ? '自适应' : ratio,
                }))}
                value={shownRatio}
                variant="ratioGrid"
                open={openPicker === 'ratio'}
                onToggle={() => onTogglePicker('ratio')}
                onClose={onClosePicker}
                onSelect={onSelectRatio}
              />
              <ParamPicker
                name="size"
                ariaLabel="视频清晰度"
                label={sizeLabel}
                options={sizeChoices}
                value={sizeValue}
                variant="list"
                open={openPicker === 'size'}
                onToggle={() => onTogglePicker('size')}
                onClose={onClosePicker}
                onSelect={onSelectSize}
              />
              {showDuration && (
                <span className={styles.duration} data-param-duration>
                  <input
                    type="range"
                    className={styles.slider}
                    data-param-duration-range
                    aria-label="视频时长滑块"
                    min={minSec}
                    max={maxSec}
                    step={1}
                    value={duration}
                    onChange={(event) => onDurationChange(event.target.value)}
                  />
                  <input
                    type="number"
                    className={styles.durationNum}
                    data-param-duration-input
                    aria-label="视频时长秒数"
                    min={minSec}
                    max={maxSec}
                    step={1}
                    value={duration}
                    onChange={(event) => onDurationChange(event.target.value)}
                  />
                  <span className={styles.durationUnit}>秒</span>
                </span>
              )}
              {showGenerateAudio && (
                <ParamPicker
                  name="generateAudio"
                  ariaLabel="生成音频"
                  label={generateAudio ? '生成音频 · 开' : '生成音频 · 关'}
                  options={[
                    { value: 'on', label: '开启' },
                    { value: 'off', label: '关闭' },
                  ]}
                  value={generateAudio ? 'on' : 'off'}
                  variant="pill"
                  open={openPicker === 'generateAudio'}
                  onToggle={() => onTogglePicker('generateAudio')}
                  onClose={onClosePicker}
                  onSelect={onSelectGenerateAudio}
                />
              )}
              {showVideoCount && (
                <ParamPicker
                  name="count"
                  ariaLabel="生成数量"
                  label={`${videoCount} 个`}
                  options={videoCounts.map((value) => ({
                    value: String(value),
                    label: `${value} 个`,
                  }))}
                  value={String(videoCount)}
                  variant="pill"
                  open={openPicker === 'count'}
                  onToggle={() => onTogglePicker('count')}
                  onClose={onClosePicker}
                  onSelect={onSelectCount}
                />
              )}
            </>
          ) : paramSections.length > 0 ? (
            <ParamPicker
              name="gen-params"
              ariaLabel={`生成参数（${paramsLabel}）`}
              label={paramsLabel}
              sections={paramSections}
              open={openPicker === 'gen-params'}
              onToggle={() => onTogglePicker('gen-params')}
              onClose={onClosePicker}
            />
          ) : null}
          {!videoMode && countChoices.length > 1 && (
            <ParamPicker
              name="count"
              ariaLabel="生成数量"
              label={`${count} 张`}
              options={countChoices.map((value) => ({
                value: String(value),
                label: `${value} 张`,
                disabled: value > maxCount,
                title: value > maxCount ? `当前模型最多 ${maxCount} 张` : `${value} 张`,
              }))}
              value={String(count)}
              variant="pill"
              open={openPicker === 'count'}
              onToggle={() => onTogglePicker('count')}
              onClose={onClosePicker}
              onSelect={onSelectCount}
            />
          )}
          {isMj && (
            <ParamPicker
              name="mj-params"
              ariaLabel="Midjourney 高级设置"
              label="高级设置"
              sections={mjSections}
              open={openPicker === 'mj-params'}
              onToggle={() => onTogglePicker('mj-params')}
              onClose={onClosePicker}
            />
          )}
        </>
      )}
    </>
  )
}

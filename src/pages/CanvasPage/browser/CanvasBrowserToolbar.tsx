import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Expand,
  ExternalLink,
  Globe,
  GripVertical,
  Icon,
  ImageDown,
  Lock,
  RotateCw,
  Sparkles,
  X,
  type IconGlyph,
} from '../../../ui/icon'
import {
  browserAddressError,
  describeBrowserAddress,
  normalizeBrowserAddress,
} from '../../../domain/canvas/browserAddress'
import styles from './CanvasBrowserToolbar.module.css'

export interface CanvasBrowserToolbarProps {
  url: string
  loading: boolean
  canBack: boolean
  canForward: boolean
  saving: boolean
  onNavigate: (url: string) => void
  onBack: () => void
  onForward: () => void
  onReloadOrStop: () => void
  onSave: () => void
  onOpenExternal: () => void
  onResetWindow: () => void
  onClose: () => void
  onAddressError: (message: string) => void
  onDragStart: (event: React.PointerEvent) => void
  onDragKey: (event: React.KeyboardEvent) => void
  /** 「交给 Agent」按钮（#1089，见 `CanvasBrowserAgentButton`）；不传就不占位 */
  agentAction?: ReactNode
}

/**
 * 画布浏览器的单行工具条（2026-11-13 重做）：
 * 拖动柄 · 后退 / 前进 / 刷新或停止 · 地址栏 · 收藏 / Agent 预留位 / 系统浏览器 / 重置 / 关闭。
 * 底边 2px 是加载进度条。地址栏失焦时把主机名加粗、路径弱化；聚焦时显示完整地址并全选。
 */
export function CanvasBrowserToolbar(props: CanvasBrowserToolbarProps) {
  const { url, loading } = props
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState(url)
  useEffect(() => {
    if (!focused) setDraft(url)
  }, [focused, url])
  const parts = describeBrowserAddress(url)

  const submit = () => {
    const result = normalizeBrowserAddress(draft)
    if (!result.ok) {
      props.onAddressError(browserAddressError(result.reason))
      return
    }
    props.onNavigate(result.url)
    inputRef.current?.blur()
  }

  return (
    <header
      className={styles.toolbar}
      data-canvas-browser-toolbar
      data-loading={loading ? 'true' : 'false'}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('button, input, form, a')) return
        props.onDragStart(event)
      }}
    >
      <span
        className={styles.grip}
        data-canvas-browser-drag
        tabIndex={0}
        role="button"
        aria-label="移动浏览器窗口，可用方向键移动"
        title="拖动移动窗口"
        onKeyDown={props.onDragKey}
      >
        <Icon icon={GripVertical} size="sm" />
      </span>
      <div className={styles.group}>
        <ToolButton icon={ArrowLeft} label="后退" disabled={!props.canBack} onClick={props.onBack} data="back" />
        <ToolButton icon={ArrowRight} label="前进" disabled={!props.canForward} onClick={props.onForward} data="forward" />
        <ToolButton
          icon={loading ? X : RotateCw}
          label={loading ? '停止加载' : '刷新'}
          disabled={!url}
          onClick={props.onReloadOrStop}
          data="reload"
        />
      </div>
      <form
        className={styles.address}
        data-focused={focused ? 'true' : 'false'}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <span className={styles.addressIcon} data-secure={parts?.secure ? 'true' : 'false'}>
          <Icon icon={parts?.secure ? Lock : Globe} size="sm" />
        </span>
        <input
          ref={inputRef}
          value={draft}
          data-canvas-browser-url
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          placeholder="输入网址，例如 dribbble.com"
          aria-label="画布浏览器地址"
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => {
            setFocused(true)
            event.currentTarget.select()
          }}
          onMouseUp={(event) => {
            // 第一次点进来时浏览器会用鼠标位置覆盖全选；保留全选，之后的点击正常放光标
            if (event.currentTarget.dataset.justFocused === 'true') event.preventDefault()
            event.currentTarget.dataset.justFocused = 'false'
          }}
          onPointerDown={(event) => {
            event.currentTarget.dataset.justFocused = focused ? 'false' : 'true'
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              setDraft(url)
              event.currentTarget.blur()
            }
          }}
        />
        {!focused && parts ? (
          <span className={styles.addressDisplay} aria-hidden="true" data-canvas-browser-host>
            <strong>{parts.host}</strong>
            <span>{parts.rest}</span>
          </span>
        ) : null}
      </form>
      <div className={styles.group}>
        <ToolButton icon={ImageDown} label="收藏当前网页的图片" disabled={!url || props.saving} onClick={props.onSave} data="save" />
        {props.agentAction ? <span className={styles.agentSlot} data-canvas-browser-agent-slot>{props.agentAction}</span> : null}
        <ToolButton icon={ExternalLink} label="在系统浏览器打开" disabled={!url} onClick={props.onOpenExternal} data="external" />
        <ToolButton icon={Expand} label="重置窗口大小" onClick={props.onResetWindow} data="reset" />
        <ToolButton icon={X} label="关闭画布浏览器" onClick={props.onClose} data="close" />
      </div>
      <span className={styles.progress} aria-hidden="true" />
    </header>
  )
}

/**
 * 「交给 Agent」（对账 #1089）：把当前网页的地址、标题与页面图片交给对话窗。
 * 带文字而不是纯图标：这是工具条里唯一一个会把东西送到别处的动作，要一眼认得出来。
 */
export function CanvasBrowserAgentButton({
  disabled,
  busy,
  onClick,
}: {
  disabled: boolean
  busy: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={styles.agentButton}
      title="把当前网页（地址、标题与页面图片）交给 Agent"
      aria-label="交给 Agent：把当前网页的地址、标题与页面图片交给对话"
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={onClick}
      data-canvas-browser-action="agent"
      data-canvas-browser-agent
    >
      <Icon icon={Sparkles} size="sm" />
      <span>交给 Agent</span>
    </button>
  )
}

function ToolButton({
  icon,
  label,
  disabled,
  onClick,
  data,
}: {
  icon: IconGlyph
  label: string
  disabled?: boolean
  onClick: () => void
  data: string
}) {
  return (
    <button
      type="button"
      className={styles.toolButton}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      data-canvas-browser-action={data}
      {...(data === 'save' ? { 'data-canvas-browser-save': true } : {})}
      {...(data === 'close' ? { 'data-canvas-browser-close': true } : {})}
    >
      <Icon icon={icon} size="md" />
    </button>
  )
}

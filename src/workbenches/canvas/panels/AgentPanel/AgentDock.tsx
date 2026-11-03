import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { openAgentSettings } from '../../../../state/ui/globalSettings'
import { AgentPanel } from './AgentPanel'
import {
  AGENT_DOCK_LEGACY_STORAGE_KEY,
  AGENT_SHELL_STORAGE_KEY,
  AGENT_SHELL_WIDTH_DEFAULT,
  AGENT_SHELL_WIDTH_MIN,
  agentShellAvailableWidth,
  agentShellMaxWidth,
  agentShellStateForActivation,
  dampAgentShellWidth,
  agentShellWidth,
  clampAgentOrb,
  clampAgentShellState,
  defaultAgentShellState,
  nearestAgentShellSnap,
  parseAgentShellState,
  parseLegacyAgentShellState,
  resizedAgentShellWidth,
  type AgentShellState,
  type AgentWorkArea,
} from './agentShellLayout'
import styles from './AgentDock.module.css'

type DragState =
  | {
      kind: 'orb'
      startX: number
      startY: number
      originX: number
      originY: number
      moved: boolean
    }
  | {
      kind: 'resize'
      startX: number
      originWidth: number
      rawWidth: number
      moved: boolean
    }

function visibleCanvasSurface(): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>('[data-canvas-surface]')]
    .find((surface) => {
      const rect = surface.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }) ?? null
}

function measureCanvasWorkArea(includePanel = true): AgentWorkArea {
  const surface = visibleCanvasSurface()
  const rect = surface?.getBoundingClientRect()
  if (rect && rect.width > 0 && rect.height > 0) {
    if (!includePanel) {
      return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      }
    }
    const panel = document.querySelector<HTMLElement>(
      '[data-agent-shell-panel][data-agent-host-active="true"]',
    )
    const panelRect = panel?.getBoundingClientRect()
    const right =
      panelRect && panelRect.width > 0
        ? Math.max(rect.right, panelRect.right)
        : rect.right
    return {
      x: rect.left,
      y: rect.top,
      width: right - rect.left,
      height: rect.height,
    }
  }
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
}

function readStoredShellState(): AgentShellState | null {
  try {
    const current = parseAgentShellState(localStorage.getItem(AGENT_SHELL_STORAGE_KEY))
    if (current) return current
    return parseLegacyAgentShellState(localStorage.getItem(AGENT_DOCK_LEGACY_STORAGE_KEY))
  } catch {
    return null
  }
}

function measureAgentAvailableWidth(): number {
  const rail = document.querySelector<HTMLElement>('[data-rail-slot]')
  const railWidth = rail?.getBoundingClientRect().width ?? 64
  return agentShellAvailableWidth(window.innerWidth, railWidth)
}

function storeShellState(state: AgentShellState): void {
  try {
    localStorage.setItem(AGENT_SHELL_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // A blocked localStorage must not stop the Agent from opening.
  }
}

/**
 * 画布 Agent 的空间外壳。
 *
 * 浮球仍属于画布视口，以便用户把它放在顺手的位置；面板则通过 AppShell 提供的
 * portal 插槽固定在应用壳右侧。两者只共享“是否打开”，不共享坐标：
 * 开关面板、拖宽面板都不会回写球位，也不会改变画布尺寸。
 */
export function AgentDock({
  hostId,
  projectId,
  active,
  open,
  onOpenChange,
  onDisposeReady,
}: {
  hostId: string
  projectId: string
  active: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onDisposeReady?: (
    dispose: () => Promise<void>,
  ) => (() => void) | void
}) {
  const [mounted, setMounted] = useState(open)
  const [panelHidden, setPanelHidden] = useState(!open)
  const [shellAnimatedOpen, setShellAnimatedOpen] = useState(open)
  const [shell, setShell] = useState<AgentShellState | null>(null)
  const [dragging, setDragging] = useState<DragState['kind'] | null>(null)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const shellRef = useRef<AgentShellState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressOrbClickRef = useRef(false)

  const applyShell = useCallback((next: AgentShellState) => {
    shellRef.current = next
    setShell(next)
  }, [])

  useLayoutEffect(() => {
    if (!active) return
    const area = measureCanvasWorkArea(false)
    const availableWidth = measureAgentAvailableWidth()
    applyShell(
      agentShellStateForActivation(
        shellRef.current,
        shellRef.current ? null : readStoredShellState(),
        area,
        availableWidth,
      ),
    )

    const onAreaChange = () => {
      const nextArea = measureCanvasWorkArea()
      const nextAvailableWidth = measureAgentAvailableWidth()
      const current = shellRef.current
      applyShell(
        current
          ? clampAgentShellState(current, nextArea, nextAvailableWidth)
          : {
              ...defaultAgentShellState(nextArea),
              width: agentShellWidth(AGENT_SHELL_WIDTH_DEFAULT, nextAvailableWidth),
            },
      )
    }
    const clampToSurface = () => {
      applyShell(
        agentShellStateForActivation(
          shellRef.current,
          null,
          measureCanvasWorkArea(false),
          measureAgentAvailableWidth(),
        ),
      )
    }
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(onAreaChange)
        : null
    let observedSurface: HTMLElement | null = null
    const attachSurface = () => {
      const surface = visibleCanvasSurface()
      if (!surface || surface === observedSurface) return
      observer?.disconnect()
      observedSurface = surface
      observer?.observe(surface)
      clampToSurface()
    }
    const mutationObserver =
      typeof MutationObserver === 'function' && document.documentElement
        ? new MutationObserver(attachSurface)
        : null
    mutationObserver?.observe(document.documentElement, {
      childList: true,
      subtree: true,
    })
    attachSurface()
    window.addEventListener('resize', clampToSurface)
    /**
     * 路由切换时 surface 会在 bridge 激活后的下一次提交 / 布局才落定。
     * 首帧先按已有 surface 夹一次，再等两帧重新量当前真实 surface；
     * 否则 1440 的浮球会在 1024 返回时停在 panel 区域。
     */
    let firstFrame = 0
    let secondFrame = 0
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(clampToSurface)
    })
    const settleTimer = window.setTimeout(clampToSurface, 360)
    return () => {
      mutationObserver?.disconnect()
      observer?.disconnect()
      window.removeEventListener('resize', clampToSurface)
      window.clearTimeout(settleTimer)
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [active, applyShell])

  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>('[data-agent-shell-slot]')
    setPortalTarget(target ?? document.body)
  }, [])

  useLayoutEffect(() => {
    if (!portalTarget || !active) return
    portalTarget.setAttribute('data-agent-shell-owner', hostId)
    return () => {
      if (portalTarget.getAttribute('data-agent-shell-owner') === hostId) {
        portalTarget.removeAttribute('data-agent-shell-owner')
        portalTarget.removeAttribute('data-agent-shell-active')
        portalTarget.removeAttribute('data-agent-shell-resizing')
        portalTarget.style.removeProperty('--agent-shell-width')
      }
    }
  }, [active, hostId, portalTarget])

  useLayoutEffect(() => {
    if (
      !portalTarget ||
      !active ||
      portalTarget.getAttribute('data-agent-shell-owner') !== hostId
    ) {
      return
    }
    if (shellAnimatedOpen) portalTarget.setAttribute('data-agent-shell-active', 'true')
    else portalTarget.removeAttribute('data-agent-shell-active')
    return () => {
      if (portalTarget.getAttribute('data-agent-shell-owner') === hostId) {
        portalTarget.removeAttribute('data-agent-shell-active')
      }
    }
  }, [active, hostId, portalTarget, shellAnimatedOpen])

  useLayoutEffect(() => {
    if (
      !portalTarget ||
      !active ||
      !shell ||
      portalTarget.getAttribute('data-agent-shell-owner') !== hostId
    ) {
      return
    }
    portalTarget.style.setProperty('--agent-shell-width', `${shell.width}px`)
    return () => {
      if (portalTarget.getAttribute('data-agent-shell-owner') !== hostId) return
      portalTarget.style.removeProperty('--agent-shell-width')
    }
  }, [active, hostId, portalTarget, shell])

  useLayoutEffect(() => {
    if (
      !portalTarget ||
      !active ||
      portalTarget.getAttribute('data-agent-shell-owner') !== hostId
    ) {
      return
    }
    if (dragging === 'resize') {
      portalTarget.setAttribute('data-agent-shell-resizing', 'true')
    } else {
      portalTarget.removeAttribute('data-agent-shell-resizing')
    }
    return () => {
      if (portalTarget.getAttribute('data-agent-shell-owner') === hostId) {
        portalTarget.removeAttribute('data-agent-shell-resizing')
      }
    }
  }, [active, dragging, hostId, portalTarget])

  useLayoutEffect(() => {
    if (!active || !open) {
      setShellAnimatedOpen(false)
      return
    }
    setMounted(true)
    setPanelHidden(false)
    let secondFrame = 0
    let thirdFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        /**
         * 面板保持挂载后，卸载/重挂不再天然提供“第一帧宽度为 0”。
         * 再等一帧，让浏览器先提交收起宽度，再开启壳层宽度过渡；
         * 这样运行态不丢，展开动画也仍然存在。
         */
        thirdFrame = window.requestAnimationFrame(() => setShellAnimatedOpen(true))
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
      window.cancelAnimationFrame(thirdFrame)
    }
  }, [active, open])

  useLayoutEffect(() => {
    if (open) return
    setShellAnimatedOpen(false)
    if (!mounted || panelHidden) return
    /**
     * 收起态只隐藏宿主，不卸载 AgentPanel。
     *
     * 模型循环、AbortController、会话状态和队列泵都活在 AgentPanel 内；
     * 关闭面板时卸载会让正在运行的任务失去停止能力与思考态。
     */
    const timer = window.setTimeout(() => setPanelHidden(true), 260)
    return () => window.clearTimeout(timer)
  }, [mounted, open, panelHidden])

  const beginDrag = (event: ReactPointerEvent<HTMLElement>, next: DragState) => {
    if (event.button !== 0) return
    event.preventDefault()
    if (next.kind === 'orb') {
      suppressOrbClickRef.current = false
      event.currentTarget.focus()
    }
    dragRef.current = next
    setDragging(next.kind)

    const onMove = (moveEvent: PointerEvent) => {
      const current = dragRef.current
      const base = shellRef.current
      if (!current || !base) return
      const area = measureCanvasWorkArea()

      if (current.kind === 'orb') {
        const dx = moveEvent.clientX - current.startX
        const dy = moveEvent.clientY - current.startY
        if (Math.hypot(dx, dy) > 4) current.moved = true
        applyShell({
          ...base,
          orb: clampAgentOrb(
            {
              x: current.originX + dx,
              y: current.originY + dy,
            },
            area,
          ),
        })
        return
      }

      const availableWidth = measureAgentAvailableWidth()
      const rawWidth = resizedAgentShellWidth(
        current.originWidth,
        current.startX,
        moveEvent.clientX,
        availableWidth,
      )
      current.rawWidth = rawWidth
      if (Math.abs(moveEvent.clientX - current.startX) > 4) current.moved = true
      applyShell({
        ...base,
        width: dampAgentShellWidth(rawWidth, availableWidth),
      })
    }

    const finish = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      const current = dragRef.current
      setDragging(null)
      if (current?.kind === 'orb') {
        suppressOrbClickRef.current = current.moved
        window.setTimeout(() => {
          suppressOrbClickRef.current = false
        }, 0)
      }
      if (current?.kind === 'resize') {
        const availableWidth = measureAgentAvailableWidth()
        const snapped = nearestAgentShellSnap(current.rawWidth, availableWidth)
        if (snapped) {
          const latest = shellRef.current
          if (latest) applyShell({ ...latest, width: snapped })
        }
      }
      if (shellRef.current) storeShellState(shellRef.current)
      dragRef.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const onOrbPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = shellRef.current
    if (!current) return
    beginDrag(event, {
      kind: 'orb',
      startX: event.clientX,
      startY: event.clientY,
      originX: current.orb.x,
      originY: current.orb.y,
      moved: false,
    })
  }

  const onResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = shellRef.current
    if (!current) return
    beginDrag(event, {
      kind: 'resize',
      startX: event.clientX,
      originWidth: current.width,
      rawWidth: current.width,
      moved: false,
    })
  }

  const saveWidth = (width: number) => {
    const current = shellRef.current
    if (!current) return
    const next = {
      ...current,
      width: agentShellWidth(width, measureAgentAvailableWidth()),
    }
    applyShell(next)
    storeShellState(next)
  }

  const onResizeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const current = shellRef.current
    if (!current) return
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      saveWidth(current.width + 16)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      saveWidth(current.width - 16)
    } else if (event.key === 'Home') {
      event.preventDefault()
      saveWidth(AGENT_SHELL_WIDTH_MIN)
    } else if (event.key === 'End') {
      event.preventDefault()
      saveWidth(agentShellMaxWidth(measureAgentAvailableWidth()))
    }
  }

  const panelId =
    `canvas-agent-panel-${projectId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const panel =
    mounted && portalTarget && shell
      ? createPortal(
          <div
            id={panelId}
            className={styles.panelFrame}
            data-agent-floating-panel={active ? true : undefined}
            data-agent-shell-panel={active ? true : undefined}
            data-agent-host-control={active ? undefined : true}
            data-agent-host-id={hostId}
            data-agent-host-active={active ? 'true' : 'false'}
            data-agent-shell-panel-width={shell.width}
            data-agent-shell-open={open ? 'true' : 'false'}
            data-agent-dragging={dragging ?? undefined}
            hidden={!active || panelHidden}
            role="region"
            aria-label="Agent 面板"
          >
            <div
              className={styles.panelSurface}
              data-agent-shell-surface={active ? true : undefined}
            >
              <AgentPanel
                projectId={projectId}
                active={active}
                onClose={() => onOpenChange(false)}
                onOpenSettings={() => openAgentSettings('basic')}
                onDisposeReady={onDisposeReady}
              />
            </div>
            <button
              type="button"
              className={styles.resizeHandle}
              data-agent-resize
              role="separator"
              aria-orientation="vertical"
              aria-controls={panelId}
              aria-label="调整 Agent 面板宽度"
              aria-valuemin={AGENT_SHELL_WIDTH_MIN}
              aria-valuemax={agentShellMaxWidth(measureAgentAvailableWidth())}
              aria-valuenow={shell.width}
              title="左右拖动调整宽度；方向键微调"
              onPointerDown={onResizePointerDown}
              onKeyDown={onResizeKeyDown}
            />
          </div>,
          portalTarget,
        )
      : null

  return (
    <>
      {active ? (
        <button
          type="button"
          className={styles.orb}
          style={shell ? { left: shell.orb.x, top: shell.orb.y } : undefined}
          data-canvas-agent
          data-agent-orb
          data-agent-expanded={open ? 'true' : 'false'}
          aria-label={open ? '收起 Agent' : '打开 Agent'}
          aria-controls={panelId}
          aria-expanded={open}
          title={open ? '收起 Agent' : 'Agent'}
          onPointerDown={onOrbPointerDown}
          onClick={() => {
            if (suppressOrbClickRef.current) {
              suppressOrbClickRef.current = false
              return
            }
            onOpenChange(!open)
          }}
        >
          <span className={styles.orbSwirl} aria-hidden="true" />
          <span className={styles.orbGlint} aria-hidden="true" />
          <span className={styles.orbLabel} aria-hidden="true">
            {open ? '收起 Agent' : 'Agent'}
          </span>
        </button>
      ) : null}
      {panel}
    </>
  )
}

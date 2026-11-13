import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import {
  deactivateAgentHost,
  invalidateAgentHostsForHmr,
  registerAgentHostRenderer,
  setAgentHostDisposer,
  setAgentHostOpen,
  upsertAgentHost,
  type AgentHostRendererProps,
} from '../../../../app/AgentHostRegistry'
import {
  disposeAllProjectRuntimes,
  registerProjectRuntime,
} from '../../../../app/ProjectRuntimeRegistry'
import {
  subscribeAgentHandoff,
  subscribeReferenceAgentHandoff,
  subscribeWebPageAgentHandoff,
} from '../../../../features/canvas/agentHandoff'
import {
  type TaskShutdownControl,
} from '../../../../features/shared/lifecycle/taskLifecycle'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
import {
  CanvasExecutionValueProvider,
  createCanvasExecutionHostAdapter,
  useCanvasExecution,
  type CanvasExecutionApi,
} from '../../execution/CanvasExecutionProvider'
import {
  isCanvasExecutionRuntimeClosed,
} from '../../execution/canvasExecutionRuntime'
import {
  CanvasStoreProvider,
  useCanvasStore,
} from '../../storeContext'
import { AgentDock } from './AgentDock'
import { createCanvasAgentHostShutdownControl } from './canvasAgentHostShutdown'

export const CANVAS_AGENT_HOST_KIND = 'canvas-agent'

export interface CanvasAgentHostPayload {
  projectId: string
  store: CanvasStore
  execution: CanvasExecutionApi
}

export function canvasAgentHostId(projectId: string): string {
  return `${CANVAS_AGENT_HOST_KIND}:${projectId}`
}

function isCanvasAgentHostPayload(
  payload: unknown,
): payload is CanvasAgentHostPayload {
  if (!payload || typeof payload !== 'object') return false
  const row = payload as Partial<CanvasAgentHostPayload>
  return (
    typeof row.projectId === 'string' &&
    typeof row.store === 'object' &&
    row.store !== null &&
    typeof row.execution === 'object' &&
    row.execution !== null
  )
}

export function CanvasAgentHostRenderer({
  host,
}: AgentHostRendererProps) {
  const registerDispose = useCallback(
    (beginShutdown: () => TaskShutdownControl) =>
      setAgentHostDisposer(host.id, beginShutdown, host.generation),
    [host.generation, host.id],
  )
  const payload = host.payload
  if (!isCanvasAgentHostPayload(payload)) return null
  return (
    <CanvasStoreProvider store={payload.store}>
      <CanvasExecutionValueProvider value={payload.execution}>
        <div
          data-canvas-agent-host={payload.projectId}
          style={{ display: 'contents' }}
        >
          <AgentDock
            hostId={host.id}
            projectId={payload.projectId}
            active={host.active}
            open={host.open}
            onOpenChange={(open) =>
              setAgentHostOpen(host.id, open)}
            onDisposeReady={registerDispose}
          />
        </div>
      </CanvasExecutionValueProvider>
    </CanvasStoreProvider>
  )
}

function ensureCanvasAgentHostRenderer(): void {
  registerAgentHostRenderer(
    CANVAS_AGENT_HOST_KIND,
    CanvasAgentHostRenderer,
  )
}

ensureCanvasAgentHostRenderer()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    invalidateAgentHostsForHmr(CANVAS_AGENT_HOST_KIND)
    void disposeAllProjectRuntimes().catch((error) => {
      console.error('[agent-host] HMR dispose failed', error)
    })
  })
}

/**
 * CanvasPage 内的薄 bridge：只发布 store + execution 的常驻 descriptor。
 *
 * 路由卸载时只把 host 标成 inactive；renderer、AgentPanel 与运行态继续留在
 * AppShell 的 AgentHostOutlet 中。
 */
export function CanvasAgentHostBridge({
  projectId,
}: {
  projectId: string
}) {
  const store = useCanvasStore()
  const execution = useCanvasExecution()
  const executionHost = useMemo(
    () => createCanvasExecutionHostAdapter(projectId, execution),
    [execution, projectId],
  )
  const payload = useMemo<CanvasAgentHostPayload>(
    () => ({ projectId, store, execution: executionHost }),
    [executionHost, projectId, store],
  )
  const payloadRef = useRef(payload)
  payloadRef.current = payload
  const hostId = canvasAgentHostId(projectId)

  useLayoutEffect(() => {
    ensureCanvasAgentHostRenderer()
    if (isCanvasExecutionRuntimeClosed(projectId)) return
    const host = upsertAgentHost({
      id: hostId,
      kind: CANVAS_AGENT_HOST_KIND,
      payload,
      active: true,
    })
    registerProjectRuntime({
      projectId,
      key: CANVAS_AGENT_HOST_KIND,
      beginDispose: () =>
        createCanvasAgentHostShutdownControl({
          projectId,
          hostId,
          generation: host.generation,
        }),
    })
  }, [hostId, payload, projectId])

  useLayoutEffect(
    () => () => deactivateAgentHost(hostId, payloadRef.current),
    [hostId],
  )

  useEffect(
    () =>
      subscribeAgentHandoff(projectId, () => {
        setAgentHostOpen(hostId, true)
      }),
    [hostId, projectId],
  )

  useEffect(
    () =>
      subscribeReferenceAgentHandoff(projectId, () => {
        setAgentHostOpen(hostId, true)
      }),
    [hostId, projectId],
  )

  /** 画布浏览器「交给 Agent」（#1089）：同样把对话窗打开 */
  useEffect(
    () =>
      subscribeWebPageAgentHandoff(projectId, () => {
        setAgentHostOpen(hostId, true)
      }),
    [hostId, projectId],
  )

  return null
}

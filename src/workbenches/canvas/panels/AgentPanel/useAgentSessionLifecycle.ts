import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { ChatMessage } from '../../../../domain/shared/execution/types'

type AgentSessionPatch = Partial<
  Omit<
    AgentSession,
    'id' | 'projectId' | 'messages' | 'queuedTurns' | 'createdAt'
  >
>

export interface AgentSessionLifecycleInput {
  track: <T>(work: () => Promise<T>) => Promise<T>
  controllerRefresh: () => Promise<AgentSession[]>
  sessionsGet: (id: string) => Promise<AgentSession | null>
  sessionsMessagesFor: (id: string) => Promise<ChatMessage[]>
  sessionsUpdateFields: (
    id: string,
    patch: AgentSessionPatch,
  ) => Promise<AgentSession | null>
  sessionsRename: (id: string, title: string) => Promise<void>
  sessionsRemove: (id: string) => Promise<void>
  onSwitched: (session: AgentSession) => void
}

export interface AgentSessionRefreshResult {
  rows: readonly AgentSession[]
  applied: boolean
}

export interface AgentSessionLifecycle {
  list: readonly AgentSession[]
  current: AgentSession | null
  messages: readonly ChatMessage[]
  setList: Dispatch<SetStateAction<AgentSession[]>>
  setCurrent: Dispatch<SetStateAction<AgentSession | null>>
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
  listRef: MutableRefObject<AgentSession[]>
  currentIdRef: MutableRefObject<string | null>
  selectionVersionRef: MutableRefObject<number>
  refresh: () => Promise<AgentSessionRefreshResult>
  switchTo: (session: AgentSession) => Promise<void>
  applySessionSnapshot: (next: AgentSession) => void
  patchSession: (
    sessionId: string,
    patch: AgentSessionPatch,
  ) => Promise<AgentSession | null>
  renameSession: (sessionId: string, title: string) => Promise<void>
  removeSession: (sessionId: string) => Promise<void>
}

/**
 * 会话列表 / 当前会话 / 消息的 React 投影适配。
 * 只做显式端口调用和本地 state 同步，不持有 Store 或业务真相。
 */
export function useAgentSessionLifecycle(
  input: AgentSessionLifecycleInput,
): AgentSessionLifecycle {
  const { track } = input
  const [list, setListState] = useState<AgentSession[]>([])
  const [current, setCurrentState] = useState<AgentSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const listRef = useRef<AgentSession[]>([])
  listRef.current = list
  const discardedSessionIdsRef = useRef(new Set<string>())
  const selectionVersionRef = useRef(0)
  const refreshRequestRef = useRef(0)
  const switchRequestRef = useRef(0)
  const currentRef = useRef<AgentSession | null>(null)
  const currentIdRef = useRef<string | null>(null)
  currentRef.current = current
  currentIdRef.current = current?.id ?? null

  const filterDiscarded = useCallback(
    (rows: readonly AgentSession[]) => {
      if (discardedSessionIdsRef.current.size === 0) return [...rows]
      return rows.filter(
        (session) => !discardedSessionIdsRef.current.has(session.id),
      )
    },
    [],
  )

  const setList = useCallback(
    (value: SetStateAction<AgentSession[]>) => {
      selectionVersionRef.current += 1
      setListState((previous) => {
        const next =
          typeof value === 'function' ? value(previous) : value
        return filterDiscarded(next)
      })
    },
    [filterDiscarded],
  )

  const setCurrent = useCallback(
    (value: SetStateAction<AgentSession | null>) => {
      const next =
        typeof value === 'function' ? value(currentRef.current) : value
      selectionVersionRef.current += 1
      currentRef.current = next
      currentIdRef.current = next?.id ?? null
      setCurrentState(next)
    },
    [],
  )

  const refresh = useCallback(
    () =>
      track(async () => {
        const requestId = ++refreshRequestRef.current
        const rows = filterDiscarded(await input.controllerRefresh())
        const applied = requestId === refreshRequestRef.current
        if (applied) setList(rows)
        return { rows, applied }
      }),
    [filterDiscarded, input.controllerRefresh, setList, track],
  )

  const switchTo = useCallback(
    (session: AgentSession) =>
      track(async () => {
        if (discardedSessionIdsRef.current.has(session.id)) return
        const requestId = ++switchRequestRef.current
        const loaded =
          (await input.sessionsGet(session.id).catch(() => null)) ?? session
        const loadedMessages = await input.sessionsMessagesFor(loaded.id)
        if (requestId !== switchRequestRef.current) return
        if (discardedSessionIdsRef.current.has(loaded.id)) return
        selectionVersionRef.current += 1
        currentRef.current = loaded
        currentIdRef.current = loaded.id
        setCurrentState(loaded)
        setMessages(loadedMessages)
        input.onSwitched(loaded)
      }),
    [
      input.onSwitched,
      input.sessionsGet,
      input.sessionsMessagesFor,
      track,
    ],
  )

  const applySessionSnapshot = useCallback(
    (next: AgentSession) => {
      if (discardedSessionIdsRef.current.has(next.id)) return
      setList((previous) =>
        previous.map((item) => (item.id === next.id ? next : item)),
      )
      if (currentIdRef.current === next.id) setCurrent(next)
    },
    [setCurrent, setList],
  )

  const patchSession = useCallback(
    (sessionId: string, patch: AgentSessionPatch) =>
      track(async () => {
        const next = await input.sessionsUpdateFields(sessionId, patch)
        if (!next) return null
        setList((previous) =>
          previous.map((item) => (item.id === next.id ? next : item)),
        )
        if (currentIdRef.current === next.id) setCurrent(next)
        return next
      }),
    [input.sessionsUpdateFields, setCurrent, setList, track],
  )

  const renameSession = useCallback(
    (sessionId: string, title: string) =>
      track(async () => {
        await input.sessionsRename(sessionId, title)
      }),
    [input.sessionsRename, track],
  )

  const removeSession = useCallback(
    (sessionId: string) =>
      track(async () => {
        await input.sessionsRemove(sessionId)
        discardedSessionIdsRef.current.add(sessionId)
        setList((previous) =>
          previous.filter((session) => session.id !== sessionId),
        )
      }),
    [input.sessionsRemove, setList, track],
  )

  return {
    list,
    current,
    messages,
    setList,
    setCurrent,
    setMessages,
    listRef,
    currentIdRef,
    selectionVersionRef,
    refresh,
    switchTo,
    applySessionSnapshot,
    patchSession,
    renameSession,
    removeSession,
  }
}

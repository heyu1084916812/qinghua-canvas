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

export interface AgentSessionLifecycle {
  list: readonly AgentSession[]
  current: AgentSession | null
  messages: readonly ChatMessage[]
  setList: Dispatch<SetStateAction<AgentSession[]>>
  setCurrent: Dispatch<SetStateAction<AgentSession | null>>
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
  listRef: MutableRefObject<AgentSession[]>
  currentIdRef: MutableRefObject<string | null>
  refresh: () => Promise<readonly AgentSession[]>
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
  const [list, setList] = useState<AgentSession[]>([])
  const [current, setCurrentState] = useState<AgentSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const listRef = useRef<AgentSession[]>([])
  listRef.current = list
  const switchRequestRef = useRef(0)
  const currentRef = useRef<AgentSession | null>(null)
  const currentIdRef = useRef<string | null>(null)
  currentRef.current = current
  currentIdRef.current = current?.id ?? null

  const setCurrent = useCallback(
    (value: SetStateAction<AgentSession | null>) => {
      const next =
        typeof value === 'function' ? value(currentRef.current) : value
      currentRef.current = next
      currentIdRef.current = next?.id ?? null
      setCurrentState(next)
    },
    [],
  )

  const refresh = useCallback(
    () =>
      track(async () => {
        const rows = await input.controllerRefresh()
        setList(rows)
        return rows
      }),
    [input.controllerRefresh, track],
  )

  const switchTo = useCallback(
    (session: AgentSession) =>
      track(async () => {
        const requestId = ++switchRequestRef.current
        const loaded =
          (await input.sessionsGet(session.id).catch(() => null)) ?? session
        const loadedMessages = await input.sessionsMessagesFor(loaded.id)
        if (requestId !== switchRequestRef.current) return
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
      setList((previous) =>
        previous.map((item) => (item.id === next.id ? next : item)),
      )
      if (currentIdRef.current === next.id) setCurrent(next)
    },
    [setCurrent],
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
    [input.sessionsUpdateFields, setCurrent, track],
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
      }),
    [input.sessionsRemove, track],
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
    refresh,
    switchTo,
    applySessionSnapshot,
    patchSession,
    renameSession,
    removeSession,
  }
}

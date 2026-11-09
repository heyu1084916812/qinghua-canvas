import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
  type RefObject,
} from 'react'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type {
  MentionEditorHandle,
  MentionRef,
} from '../../text/MentionEditor'
import {
  parseMentions,
  mentionToken,
} from '../../text/MentionEditor'
import {
  AGENT_COMPOSER_HEIGHT_KEY,
  AGENT_COMPOSER_HEIGHT_MIN,
  agentComposerMaxHeight,
  clampAgentComposerHeight,
  parseAgentComposerHeight,
  resizedAgentComposerHeight,
} from './agentComposerLayout'
import { TaskLifecycleClosedError } from '../../../../features/shared/lifecycle/taskLifecycle'
import {
  clearAgentDraft,
  draftNodeIds,
  loadAgentDraft,
  pendingAssetIdsAfterDraft,
  saveAgentDraft,
  type AgentDraftStorage,
} from './agentDraft'

export interface AgentComposerControllerInput {
  session: AgentSession | null
  draftStorage: AgentDraftStorage | null
  pendingAssetIds: readonly string[]
  onPendingAssetsChange: (
    sessionId: string,
    pendingAssetIds: readonly string[],
  ) => void
  panelRef: RefObject<HTMLElement | null>
  trackRunSync: <T>(work: () => T) => T
}

export interface AgentComposerController {
  draft: string
  replaceDraft: (value: string) => void
  restoreForSession: (sessionId: string) => void
  resetForSession: (sessionId: string) => void
  openPicker: string | null
  setOpenPicker: Dispatch<SetStateAction<string | null>>
  editorRef: MutableRefObject<MentionEditorHandle | null>
  composerRef: MutableRefObject<HTMLDivElement | null>
  composerHeight: number
  composerResizing: boolean
  composerAvailableHeight: () => number
  beginComposerResize: (event: {
    button: number
    clientY: number
    preventDefault: () => void
    currentTarget: { focus: () => void }
  }) => void
  resizeComposerWithKeyboard: (event: {
    key: string
    preventDefault: () => void
  }) => void
  insertMention: (
    kind: MentionRef['kind'],
    id: string,
    label: string,
  ) => void
  setDraft: Dispatch<SetStateAction<string>>
  cancelPendingAssetSync: () => void
  writeDraftForSession: (sessionId: string, text: string) => void
  clearDraftForSession: (sessionId: string) => void
}

/**
 * 输入区本地控制：draft / picker / composer 高度 / mention 去重。
 * 只通过显式端口同步 pendingAssetIds，不读会话存储或业务 Controller。
 */
export function useAgentComposerController(
  input: AgentComposerControllerInput,
): AgentComposerController {
  const { session, draftStorage, pendingAssetIds } = input
  const trackRunSync = input.trackRunSync
  const [draft, setDraftState] = useState('')
  const [openPicker, setOpenPickerState] = useState<string | null>(null)
  const [composerHeight, setComposerHeight] = useState(() => {
    if (typeof window === 'undefined') return AGENT_COMPOSER_HEIGHT_MIN
    try {
      return parseAgentComposerHeight(
        window.localStorage.getItem(AGENT_COMPOSER_HEIGHT_KEY),
        window.innerHeight,
      )
    } catch {
      return AGENT_COMPOSER_HEIGHT_MIN
    }
  })
  const [composerResizing, setComposerResizing] = useState(false)
  const restoredSessionRef = useRef('')
  const draftNodeIdsRef = useRef<{
    sessionId: string
    ids: string[]
  }>({ sessionId: '', ids: [] })
  const pendingAssetSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const editorRef = useRef<MentionEditorHandle | null>(null)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const draftRef = useRef<{ seen: Set<string> }>({ seen: new Set() })

  const writeDraftForSession = useCallback(
    (sessionId: string, text: string) => {
      try {
        trackRunSync(() => saveAgentDraft(sessionId, text, draftStorage))
        return true
      } catch (error) {
        if (error instanceof TaskLifecycleClosedError) return false
        throw error
      }
    },
    [draftStorage, trackRunSync],
  )

  const clearDraftForSession = useCallback(
    (sessionId: string) => {
      try {
        trackRunSync(() => clearAgentDraft(sessionId, draftStorage))
        return true
      } catch (error) {
        if (error instanceof TaskLifecycleClosedError) return false
        throw error
      }
    },
    [draftStorage, trackRunSync],
  )

  const onPendingAssetsChangeRef = useRef(input.onPendingAssetsChange)
  useEffect(() => {
    onPendingAssetsChangeRef.current = input.onPendingAssetsChange
  })
  const onPendingAssetsChange = useCallback(
    (...args: Parameters<typeof input.onPendingAssetsChange>) =>
      onPendingAssetsChangeRef.current(...args),
    [],
  )
  const replaceDraft = useCallback(
    (next: string) => {
      setDraftState(next)
      if (!session) return
      writeDraftForSession(session.id, next)
      const before = [
        ...new Set([
          ...pendingAssetIds,
          ...(draftNodeIdsRef.current.sessionId === session.id
            ? draftNodeIdsRef.current.ids
            : draftNodeIds(draft)),
        ]),
      ]
      const after = pendingAssetIdsAfterDraft(before, next)
      draftNodeIdsRef.current = {
        sessionId: session.id,
        ids: draftNodeIds(next),
      }
      draftRef.current.seen = new Set(
        parseMentions(next).map(
          (mention) => `${mention.kind}:${mention.id}`,
        ),
      )
      if (
        before.length !== after.length ||
        before.some((id, index) => id !== after[index])
      ) {
        onPendingAssetsChange(session.id, after)
      }
      if (draftNodeIds(next).length === 0) {
        if (pendingAssetSyncTimerRef.current) {
          clearTimeout(pendingAssetSyncTimerRef.current)
        }
        const timer = setTimeout(() => {
          if (pendingAssetSyncTimerRef.current !== timer) return
          pendingAssetSyncTimerRef.current = null
          onPendingAssetsChange(session.id, [])
        }, 160)
        pendingAssetSyncTimerRef.current = timer
      }
    },
    [
      draft,
      onPendingAssetsChange,
      pendingAssetIds,
      session,
      writeDraftForSession,
    ],
  )

  const restoreForSession = useCallback(
    (sessionId: string) => {
      restoredSessionRef.current = sessionId
      const saved = loadAgentDraft(sessionId, draftStorage)
      if (saved !== null) {
        setDraftState(saved)
        draftRef.current.seen = new Set(
          parseMentions(saved).map(
            (mention) => `${mention.kind}:${mention.id}`,
          ),
        )
        const after = pendingAssetIdsAfterDraft(
          pendingAssetIds,
          saved,
        )
        if (
          pendingAssetIds.length !== after.length ||
          pendingAssetIds.some((id, index) => id !== after[index])
        ) {
          onPendingAssetsChange(sessionId, after)
        }
        return
      }
      setDraftState('')
      draftRef.current.seen = new Set()
    },
    [draftStorage, onPendingAssetsChange, pendingAssetIds],
  )

  const resetForSession = useCallback((sessionId: string) => {
    if (pendingAssetSyncTimerRef.current) {
      clearTimeout(pendingAssetSyncTimerRef.current)
      pendingAssetSyncTimerRef.current = null
    }
    setOpenPickerState(null)
    setComposerResizing(false)
    setDraftState('')
    draftNodeIdsRef.current = { sessionId, ids: [] }
    draftRef.current.seen = new Set()
    // 让紧随其后的 session effect 用新会话的 pendingAssetIds 恢复已存草稿。
    restoredSessionRef.current = ''
  }, [])

  const cancelPendingAssetSync = useCallback(() => {
    if (pendingAssetSyncTimerRef.current) {
      clearTimeout(pendingAssetSyncTimerRef.current)
      pendingAssetSyncTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!session || restoredSessionRef.current === session.id) return
    restoredSessionRef.current = session.id
    if (draft.trim()) return
    const saved = loadAgentDraft(session.id, draftStorage)
    if (saved !== null) {
      setDraftState(saved)
      draftRef.current.seen = new Set(
        parseMentions(saved).map(
          (mention) => `${mention.kind}:${mention.id}`,
        ),
      )
      const after = pendingAssetIdsAfterDraft(
        session.pendingAssetIds ?? [],
        saved,
      )
      if (
        (session.pendingAssetIds ?? []).length !== after.length ||
        (session.pendingAssetIds ?? []).some(
          (id, index) => id !== after[index],
        )
      ) {
        onPendingAssetsChange(session.id, after)
      }
      return
    }
    const tokens: string[] = []
    for (const id of session.pendingAssetIds ?? []) {
      tokens.push(mentionToken('node', id, id))
    }
    if (tokens.length > 0) {
      const next = tokens.join('')
      setDraftState(next)
      writeDraftForSession(session.id, next)
    }
  }, [
    draft,
    draftStorage,
    onPendingAssetsChange,
    session,
    writeDraftForSession,
  ])

  useEffect(() => {
    if (!session) return
    draftNodeIdsRef.current = {
      sessionId: session.id,
      ids: draftNodeIds(draft),
    }
  }, [draft, session])

  useEffect(
    () => () => {
      if (pendingAssetSyncTimerRef.current) {
        clearTimeout(pendingAssetSyncTimerRef.current)
        pendingAssetSyncTimerRef.current = null
      }
    },
    [],
  )

  const composerAvailableHeight = useCallback(() => {
    const panel = composerRef.current?.closest<HTMLElement>(
      '[data-agent-panel]',
    ) ?? input.panelRef.current
    return panel?.getBoundingClientRect().height ?? window.innerHeight
  }, [input.panelRef])

  const writeComposerHeight = useCallback(
    (height: number) => {
      try {
        trackRunSync(() => {
          if (typeof window === 'undefined') return
          window.localStorage.setItem(
            AGENT_COMPOSER_HEIGHT_KEY,
            String(height),
          )
        })
        return true
      } catch (error) {
        if (error instanceof TaskLifecycleClosedError) return false
        throw error
      }
    },
    [trackRunSync],
  )

  const beginComposerResize = useCallback(
    (event: {
      button: number
      clientY: number
      preventDefault: () => void
      currentTarget: { focus: () => void }
    }) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.focus()
      const startY = event.clientY
      const originHeight = composerHeight
      let latestHeight = originHeight
      setComposerResizing(true)

      const onMove = (moveEvent: PointerEvent) => {
        latestHeight = resizedAgentComposerHeight(
          originHeight,
          startY,
          moveEvent.clientY,
          composerAvailableHeight(),
        )
        setComposerHeight(latestHeight)
      }
      const finish = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
        setComposerResizing(false)
        writeComposerHeight(latestHeight)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
    },
    [composerAvailableHeight, composerHeight, writeComposerHeight],
  )

  const resizeComposerWithKeyboard = useCallback(
    (event: { key: string; preventDefault: () => void }) => {
      const maximum = agentComposerMaxHeight(composerAvailableHeight())
      let next = composerHeight
      if (event.key === 'ArrowUp') next += 16
      else if (event.key === 'ArrowDown') next -= 16
      else if (event.key === 'Home') next = AGENT_COMPOSER_HEIGHT_MIN
      else if (event.key === 'End') next = maximum
      else return
      event.preventDefault()
      const clamped = clampAgentComposerHeight(
        next,
        composerAvailableHeight(),
      )
      setComposerHeight(clamped)
      writeComposerHeight(clamped)
    },
    [composerAvailableHeight, composerHeight, writeComposerHeight],
  )

  const insertMention = useCallback(
    (
      kind: MentionRef['kind'],
      id: string,
      label: string,
    ) => {
      if (!editorRef.current) return
      if (draftRef.current.seen.has(`${kind}:${id}`)) return
      draftRef.current.seen.add(`${kind}:${id}`)
      editorRef.current?.insertMention(mentionToken(kind, id, label))
    },
    [],
  )

  return {
    draft,
    setDraft: setDraftState,
    replaceDraft,
    restoreForSession,
    resetForSession,
    writeDraftForSession,
    clearDraftForSession,
    cancelPendingAssetSync,
    openPicker,
    setOpenPicker: setOpenPickerState,
    editorRef,
    composerRef,
    composerHeight,
    composerResizing,
    composerAvailableHeight,
    beginComposerResize,
    resizeComposerWithKeyboard,
    insertMention,
  }
}

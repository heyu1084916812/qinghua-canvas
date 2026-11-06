import { useCallback, useRef } from 'react'
import { confirmationRequiresExplicitApproval } from '../../../../domain/agent/confirmation'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentPanelStatus } from './AgentActivityViews'

export interface AgentAutoRunControllerInput {
  current: AgentSession | null
  statusFor: (sessionId: string) => AgentPanelStatus
  patchSession: (
    sessionId: string,
    patch: { autoRun: boolean },
  ) => Promise<AgentSession | null>
  confirmLatest: () => Promise<unknown>
  isCurrentSession: (sessionId: string) => boolean
}

export interface AgentAutoRunController {
  setAutoRun: (autoRun: boolean) => Promise<boolean>
  autoRunFor: (sessionId: string) => boolean
  syncFromSession: (session: AgentSession) => void
  clearAutoRuns: () => void
}

export function useAgentAutoRunController(
  input: AgentAutoRunControllerInput,
): AgentAutoRunController {
  const autoRunRef = useRef(new Map<string, boolean>())
  /**
   * 每个会话**最后一次成功落库**的 autoRun。
   *
   * 失败回滚必须回到它，而不是回到「进这次 patch 之前的内存值」：
   * 串行化之后前一次 patch 可能已经成功，用内存值回滚会把那次成功也抹掉。
   */
  const persistedRef = useRef(new Map<string, boolean>())
  /** 每个会话一条写入链：同会话的 patch 严格排队，避免后写覆盖前写。 */
  const writeChainRef = useRef(new Map<string, Promise<unknown>>())
  /** 每个会话的点击序号：只有**最新一次点击**才有权改写实时值。 */
  const intentRef = useRef(new Map<string, number>())

  const setAutoRun = useCallback(
    async (autoRun: boolean): Promise<boolean> => {
      const target = input.current
      if (!target) return false
      const sessionId = target.id
      const status = input.statusFor(target.id)
      const shouldConfirm =
        autoRun &&
        status.kind === 'awaitingConfirm' &&
        !confirmationRequiresExplicitApproval(
          status.request.name,
          status.request.args,
          { autoRun },
        )

      /** 乐观写：UI 立刻变，不等落库。 */
      autoRunRef.current.set(sessionId, autoRun)
      if (!persistedRef.current.has(sessionId)) {
        persistedRef.current.set(sessionId, target.autoRun === true)
      }
      const intent = (intentRef.current.get(sessionId) ?? 0) + 1
      intentRef.current.set(sessionId, intent)

      const rollback = (): void => {
        /**
         * 只有最新一次点击才有权改实时值：旧请求的失败不能把用户新的意图冲掉，
         * 新请求自己的结算会把值写成最终结果。
         */
        if (intentRef.current.get(sessionId) !== intent) return
        autoRunRef.current.set(
          sessionId,
          persistedRef.current.get(sessionId) === true,
        )
      }

      const runWrite = async (): Promise<boolean> => {
        try {
          const updated = await input.patchSession(sessionId, { autoRun })
          if (!updated) {
            rollback()
            return false
          }
          persistedRef.current.set(sessionId, autoRun)
          if (intentRef.current.get(sessionId) === intent) {
            autoRunRef.current.set(sessionId, autoRun)
          }
        } catch (error) {
          rollback()
          throw error
        }

        if (shouldConfirm && input.isCurrentSession(sessionId)) {
          const latestStatus = input.statusFor(sessionId)
          if (
            latestStatus.kind === 'awaitingConfirm' &&
            !confirmationRequiresExplicitApproval(
              latestStatus.request.name,
              latestStatus.request.args,
              { autoRun },
            )
          ) {
            await input.confirmLatest()
          }
        }
        return true
      }

      const previousWrite = writeChainRef.current.get(sessionId)
      /**
       * 没有排队中的写入时**同步**开跑：第一次点击照旧立刻发起 patch，
       * 不因串行化多等一个微任务（保持拆分前的时序）。
       */
      const write = previousWrite
        ? /** 前一条失败不能掐断整条链。 */
          previousWrite.catch(() => undefined).then(runWrite)
        : runWrite()

      writeChainRef.current.set(sessionId, write)
      const settle = (): void => {
        if (writeChainRef.current.get(sessionId) === write) {
          writeChainRef.current.delete(sessionId)
        }
      }
      void write.then(settle, settle)
      return write
    },
    [
      input.confirmLatest,
      input.current,
      input.isCurrentSession,
      input.patchSession,
      input.statusFor,
    ],
  )

  const autoRunFor = useCallback(
    (sessionId: string) => autoRunRef.current.get(sessionId) === true,
    [],
  )

  const syncFromSession = useCallback((session: AgentSession) => {
    autoRunRef.current.set(session.id, session.autoRun === true)
    persistedRef.current.set(session.id, session.autoRun === true)
  }, [])

  const clearAutoRuns = useCallback(() => {
    autoRunRef.current.clear()
    persistedRef.current.clear()
    intentRef.current.clear()
    writeChainRef.current.clear()
  }, [])

  return {
    setAutoRun,
    autoRunFor,
    syncFromSession,
    clearAutoRuns,
  }
}

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import type { Channel } from '../../../../domain/project/channel'
import { runRouteCandidatesOf } from '../../../../domain/project/generationRouting'
import { toLogicalName } from '../../../../domain/project/modelCatalog'
import {
  createModelRoutePort,
  type ModelRoutePort,
} from '../../../../features/shared/agent/ModelRoutePort'
import {
  createRouteExecutionPort,
  type RouteExecutionPort,
} from '../../../../features/shared/agent/RouteExecutionPort'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { ChannelStore } from '../../../../state/channel/channelStore'
import type {
  AgentChatRoute,
  ChatRoutePreparation,
} from './agentChatRoute'

export interface AgentChatRoutingInput {
  channels: Pick<
    ChannelStore,
    'planGenerationRoute' | 'completeWithTools'
  >
  allChannels: readonly Channel[]
}

export interface AgentChatRouting {
  modelRoute: ModelRoutePort
  routeExecution: RouteExecutionPort
  cachedChatRoute: (session: AgentSession) => AgentChatRoute | null
  prepareChatRoute: (
    session: AgentSession,
    fresh?: boolean,
  ) => Promise<ChatRoutePreparation>
  commitChatRoute: (
    sessionId: string,
    expectedRoute: AgentChatRoute,
    nextRoute: AgentChatRoute,
  ) => boolean
  clearChatRoute: (sessionId: string) => void
  clearChatRoutes: () => void
}

export function useAgentChatRouting(
  input: AgentChatRoutingInput,
): AgentChatRouting {
  const routesRef = useRef(
    new Map<
      string,
      {
        route: AgentChatRoute
        source: readonly Channel[]
      }
    >(),
  )
  const prepareIdsRef = useRef(new Map<string, number>())
  const cacheEpochRef = useRef(0)
  const channelsSourceRef = useRef(input.allChannels)
  channelsSourceRef.current = input.allChannels

  const modelRoute = useMemo(
    () =>
      createModelRoutePort((request) =>
        input.channels.planGenerationRoute(request),
      ),
    [input.channels],
  )
  const routeExecution = useMemo(
    () =>
      createRouteExecutionPort((request) => {
        const { onStream, ...rest } = request
        return input.channels.completeWithTools({
          ...rest,
          ...(onStream ? { onChunk: onStream } : {}),
        })
      }),
    [input.channels],
  )

  const clearChatRoute = useCallback((sessionId: string) => {
    prepareIdsRef.current.set(
      sessionId,
      (prepareIdsRef.current.get(sessionId) ?? 0) + 1,
    )
    routesRef.current.delete(sessionId)
  }, [])

  const clearChatRoutes = useCallback(() => {
    cacheEpochRef.current += 1
    routesRef.current.clear()
    prepareIdsRef.current.clear()
  }, [])

  useLayoutEffect(() => {
    clearChatRoutes()
  }, [input.allChannels, clearChatRoutes])

  const cachedChatRoute = useCallback(
    (session: AgentSession): AgentChatRoute | null => {
      const source = channelsSourceRef.current
      const logicalModel =
        toLogicalName(source, session.model) ||
        session.model.trim()
      const cached = routesRef.current.get(session.id)
      if (!cached) return null
      if (cached.source !== source) {
        clearChatRoute(session.id)
        return null
      }
      if (cached.route.logicalModel === logicalModel) return cached.route
      clearChatRoute(session.id)
      return null
    },
    [clearChatRoute],
  )

  const prepareChatRoute = useCallback(
    async (
      session: AgentSession,
      fresh = false,
    ): Promise<ChatRoutePreparation> => {
      const source = channelsSourceRef.current
      const logicalModel =
        toLogicalName(source, session.model) ||
        session.model.trim()
      if (!logicalModel) {
        return {
          ok: false,
          message: '还没选模型：先在上面选一个对话模型',
        }
      }
      const cached = cachedChatRoute(session)
      if (!fresh && cached) return { ok: true, route: cached }

      const prepareId =
        (prepareIdsRef.current.get(session.id) ?? 0) + 1
      prepareIdsRef.current.set(session.id, prepareId)
      const cacheEpoch = cacheEpochRef.current
      const planned = await modelRoute.plan({
        capability: 'chat',
        logicalModel,
      })
      if (!planned.ok) {
        const message =
          planned.reason === 'no_token'
            ? `「${logicalModel}」的 Key 还未配置`
            : planned.reason === 'policy_excluded'
              ? `「${logicalModel}」已被当前路由范围排除`
              : `没有可用的模型服务提供「${logicalModel}」：请在模型服务里勾选该模型或补好模型映射`
        return { ok: false, message }
      }

      const candidates = runRouteCandidatesOf(planned.plan)
      const first = candidates[0]
      if (!first) {
        return {
          ok: false,
          message: `没有可用的模型服务提供「${logicalModel}」`,
        }
      }
      const route: AgentChatRoute = {
        channelId: first.channelId,
        ...(first.credentialGroupId
          ? { credentialGroupId: first.credentialGroupId }
          : {}),
        logicalModel,
        upstreamModel: first.model,
        routePlanId: `${planned.plan.logicalModel}:${planned.plan.capability}:${planned.plan.strategy}`,
        candidates,
      }
      if (
        cacheEpoch === cacheEpochRef.current &&
        source === channelsSourceRef.current &&
        prepareIdsRef.current.get(session.id) === prepareId
      ) {
        routesRef.current.set(session.id, { route, source })
      }
      return { ok: true, route }
    },
    [cachedChatRoute, modelRoute],
  )

  const commitChatRoute = useCallback(
    (
      sessionId: string,
      expectedRoute: AgentChatRoute,
      nextRoute: AgentChatRoute,
    ) => {
      const current = routesRef.current.get(sessionId)
      if (
        !current ||
        current.source !== channelsSourceRef.current ||
        current.route !== expectedRoute
      ) {
        return false
      }
      routesRef.current.set(sessionId, {
        route: nextRoute,
        source: current.source,
      })
      return true
    },
    [],
  )

  return {
    modelRoute,
    routeExecution,
    cachedChatRoute,
    prepareChatRoute,
    commitChatRoute,
    clearChatRoute,
    clearChatRoutes,
  }
}

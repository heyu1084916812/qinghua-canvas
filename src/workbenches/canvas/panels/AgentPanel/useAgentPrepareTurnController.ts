import { useCallback } from 'react'
import type { PlatformKit } from '../../../../platform/ports'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
import type { AgentPrepareArgs } from './agentSendTurnRun'
import type {
  AgentTurnRequestPreparation,
  PrepareAgentTurnRequestInput,
} from './agentTurnRequest'

type PrepInput = PrepareAgentTurnRequestInput

/**
 * `prepareAgentTurnRequest` 的**入参装配**。
 *
 * 这一层只回答"数据从哪来"，不回答"什么顺序"——
 * `onPersisted → onRouteReady` 的先后由 `agentSendTurnRun` 调用，
 * 准备阶段内部的落库/路由顺序在 `agentTurnRequest.ts`，都不在这里。
 *
 * 快照时机（与拆分前逐项一致，别"顺手统一"）：
 * - `graph` / `projectId`：**每次调用现取**，而且是**两次独立快照**
 *   （旧实现就是 `store.getSnapshot()` 调了两遍）；
 * - `selection` / 其它依赖：**渲染快照**（闭包），随面板重渲染更新；
 * - `session` / `text` / `internalControl` / `signal`：**点击瞬间值**，由 sender 传入。
 */
export interface AgentPrepareTurnControllerInput {
  store: Pick<CanvasStore, 'getSnapshot' | 'notify'>
  platform: Pick<PlatformKit, 'assets'>
  prepareChatRoute: (
    session: AgentSession,
    fresh?: boolean,
  ) => ReturnType<PrepInput['prepareRoute']>
  selection: PrepInput['selection']
  sessions: PrepInput['sessions']
  memory: PrepInput['memory']
  allSkills: PrepInput['skills']
  allChannels: PrepInput['channels']
  canvasReviewEnabled: PrepInput['canvasReviewEnabled']
  activeAgentTools: PrepInput['activeAgentTools']
  generationAvailability: PrepInput['generationAvailability']
  routeExecution: PrepInput['routeExecution']
  prepare: (
    input: PrepInput,
  ) => Promise<AgentTurnRequestPreparation>
}

export type AgentPrepareTurn = (
  args: AgentPrepareArgs,
) => Promise<AgentTurnRequestPreparation>

export function useAgentPrepareTurnController(
  input: AgentPrepareTurnControllerInput,
): AgentPrepareTurn {
  return useCallback<AgentPrepareTurn>(
    ({ session, text, internalControl, signal, hooks }) =>
      input.prepare({
        session,
        text,
        internalControl,
        graph: input.store.getSnapshot(),
        selection: input.selection,
        sessions: input.sessions,
        // `true` = 本次强制重新准备路由（别退化成缓存命中）。
        prepareRoute: () => input.prepareChatRoute(session, true),
        signal,
        memory: input.memory,
        projectId: input.store.getSnapshot().projectId,
        readAssetMime: async (hash) =>
          (await input.platform.assets.read(hash).catch(() => null))?.mime ??
          null,
        notifyContextError: (message) =>
          input.store.notify(message, 'error'),
        skills: input.allSkills,
        channels: input.allChannels,
        canvasReviewEnabled: input.canvasReviewEnabled,
        activeAgentTools: input.activeAgentTools,
        generationAvailability: input.generationAvailability,
        routeExecution: input.routeExecution,
        notifyRecordWarning: (warning) =>
          input.store.notify(
            `结果已返回，但运行记录写入失败：${warning}`,
            'error',
          ),
        // 两个顺序回调原样透传：它们的执行时机在发送主体里。
        onPersisted: hooks.onPersisted,
        onRouteReady: hooks.onRouteReady,
      }),
    [
      input.activeAgentTools,
      input.allChannels,
      input.allSkills,
      input.canvasReviewEnabled,
      input.generationAvailability,
      input.memory,
      input.platform,
      input.prepare,
      input.prepareChatRoute,
      input.routeExecution,
      input.selection,
      input.sessions,
      input.store,
    ],
  )
}

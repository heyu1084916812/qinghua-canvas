import type { TextRunRequest } from '../../../../platform/channels/types'
import {
  directTextTrace,
  type DirectRunRouteCandidate,
  type DirectRunTraceInput,
} from '../../../../state/shared/directRun'
import type { AgentChatRoute } from './agentChatRoute'
import type { AgentTurnContextTrace } from './agentTurnRequest'

export function agentLoopTrace(args: {
  projectId: string
  sessionId: string
  operationId: string
  request: TextRunRequest
  purpose: 'agent' | 'agent-tool-probe'
  toolMode: 'native' | 'json'
  context?: AgentTurnContextTrace
}): DirectRunTraceInput {
  const { request } = args
  return directTextTrace({
    projectId: args.projectId,
    workbench: 'canvas',
    subjectId: args.sessionId,
    scopeId: `session:${args.sessionId}`,
    operationId: args.operationId,
    purpose: args.purpose,
    channelId: request.channelId,
    model: request.model,
    prompt: request.prompt,
    inputs: request.inputs,
    params: {
      toolMode: args.toolMode,
      messageCount: request.messages?.length ?? 0,
      ...(args.context
        ? {
            contextDigest: args.context.digest,
            memoryRefs: args.context.memoryRefs,
            kitVersionRefs: args.context.kitVersionRefs,
          }
        : {}),
    },
  })
}

/**
 * 把成功候选提升到队首，返回新 route；调用方负责写回自己的缓存。
 *
 * 纯函数：不原地改写旧 route。`credentialGroupId` 必须跟随本次选中的候选 ——
 * 选中项没有分组时要**清掉**旧分组，否则本轮后续请求会带着上一组的 Key 分组。
 */
export function promoteAgentChatRouteCandidate(
  route: AgentChatRoute,
  selected: DirectRunRouteCandidate,
): AgentChatRoute {
  const promoted: AgentChatRoute = {
    ...route,
    channelId: selected.channelId,
    upstreamModel: selected.model,
    candidates: [
      selected,
      ...route.candidates.filter(
        (candidate) =>
          candidate.channelId !== selected.channelId ||
          candidate.credentialGroupId !==
            selected.credentialGroupId ||
          candidate.model !== selected.model,
      ),
    ],
  }
  if (selected.credentialGroupId) {
    promoted.credentialGroupId = selected.credentialGroupId
  } else {
    delete promoted.credentialGroupId
  }
  return promoted
}

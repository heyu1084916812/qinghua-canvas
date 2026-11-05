/**
 * 单次文本模型调用：维持逻辑名选路、上游模型映射、directRun 留痕和链接取消信号。
 * 只拥有这次请求的编排；渠道状态、存储、运行态锁均由显式端口提供。
 */
import { ChannelError } from '../../../../platform/channels/types'
import type { Channel } from '../../../../domain/project/channel'
import type { GenerationClient } from '../../../../platform/generation/generationClient'
import type { PlatformKit } from '../../../../platform/ports'
import type { NodeInput } from '../../../../domain/shared/execution/types'
import type { WorkbenchId } from '../../../../domain/shared/workbench'
import { resolveUpstreamModel } from '../../../../domain/project/modelMapping'
import { createId } from '../../../../shared/id'
import { directTextTrace, runDirectText } from '../../../../state/shared/directRun'
import { resolveTextRoute } from '../textRoute'

export type CanvasTextPurpose =
  | 'optimize'
  | 'translate'
  | 'describe'
  | 'skill'
  | 'compose'
  | 'face-detect'
  | 'text'

export interface CanvasTextRequest {
  channelId: string
  model: string
  subjectId: string
  purpose: CanvasTextPurpose
  system: string
  text: string
  inputs?: NodeInput[]
  signal: AbortSignal
}

export type CanvasCompleteText = (request: CanvasTextRequest) => Promise<string>

export interface CanvasTextExecutionPorts {
  channels: () => readonly Channel[]
  generation: Pick<GenerationClient, 'completeText'>
  storage: PlatformKit['storage']
  projectId: () => string
  workbench: WorkbenchId
  notify: (text: string, tone?: 'info' | 'error') => void
  linkedSignal: () => AbortSignal
}

export async function completeCanvasText(
  request: CanvasTextRequest,
  ports: CanvasTextExecutionPorts,
): Promise<string> {
  const {
    channelId,
    model,
    subjectId,
    purpose,
    system,
    text,
    inputs,
  } = request
  const signal = ports.linkedSignal()
  const all = ports.channels()
  const route = resolveTextRoute(all, channelId, model)
  if (!route) throw new ChannelError({ kind: 'channel', detail: 'missingModel' })
  const channel = all.find((item) => item.id === route.channelId)
  if (!channel) throw new ChannelError({ kind: 'channel', detail: 'missingChannel' })
  const prompt = system ? `${system}\n\n${text}` : text
  const sentModel = resolveUpstreamModel(channel.modelMap, route.model) ?? route.model
  const operationId = createId('op')
  return runDirectText({
    storage: ports.storage,
    trace: directTextTrace({
      projectId: ports.projectId(),
      workbench: ports.workbench,
      subjectId,
      scopeId: `session:${subjectId}`,
      operationId,
      purpose,
      channelId: channel.id,
      model: sentModel,
      prompt: text,
      inputs: inputs ?? [],
      params: { system, requestedModel: route.model },
    }),
    channelId: channel.id,
    signal,
    call: async (callSignal) => {
      const result = await ports.generation.completeText(
        {
          channel,
          model: route.model,
          request: {
            kind: 'text',
            prompt,
            inputs: inputs ?? [],
            params: {},
          },
          hints: { operationId },
        },
        callSignal,
      )
      return result.text
    },
    onRecordWarning: (warning) =>
      ports.notify(`结果已返回，但运行日志写入失败：${warning}`, 'error'),
  })
}

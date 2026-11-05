/**
 * 提示词节点执行前的准备编排：技能 -> 文本模型 -> 正文，或草稿 -> 正文。
 * 不拥有技能库、渠道状态或 React 生命周期；所有业务动作经显式端口调用。
 */
import { composePromptFromDraft } from '../../../../features/canvas/execution/composePrompt'
import { promptSpec } from '../../../../domain/canvas/nodeSpecs/prompt'
import type { GraphSnapshot } from '../../../../domain/canvas/model/graph'
import type { NodeSnapshot, PromptData } from '../../../../domain/canvas/model/node'
import type { NodeInput } from '../../../../domain/shared/execution/types'
import type { PromptToolAction } from '../../../../domain/prompt/presetText'
import { trimToolResult } from '../../../../features/shared/promptTools/promptTools'
import { asAppError, describeError } from '../../../../shared/result'
import type { CanvasCompleteText } from './textExecution'

export type PromptPreparationResult = 'none' | 'applied' | 'failed'

export interface PromptSkill {
  id: string
  name: string
  content: string
  inputMode: 'text' | 'image' | 'text-image' | 'any'
}

export interface CanvasPromptPreparationPorts {
  graph: () => GraphSnapshot
  dispatch: (command: {
    kind: 'node.updateData'
    id: string
    patch: Record<string, unknown>
    transient: boolean
  }) => unknown
  notify: (text: string, tone?: 'info' | 'error') => void
  skills: () => readonly PromptSkill[]
  presetOverrides: Partial<Record<PromptToolAction, string>>
  completeText: CanvasCompleteText
}

function notifyError(
  ports: CanvasPromptPreparationPorts,
  text: string,
): void {
  ports.notify(text, 'error')
}

export async function applySelectedSkill(
  node: NodeSnapshot<PromptData>,
  signal: AbortSignal,
  ports: CanvasPromptPreparationPorts,
): Promise<PromptPreparationResult> {
  if (signal.aborted) return 'failed'
  const skillId = node.data.skillId
  if (!skillId) return 'none'
  const skill = ports.skills().find((item) => item.id === skillId)
  if (!skill) {
    ports.dispatch({
      kind: 'node.updateData',
      id: node.id,
      patch: { skillId: undefined },
      transient: false,
    })
    notifyError(ports, '选中的技能已被删除，已取消选择，请重新选择后再生成')
    return 'failed'
  }

  const text = (node.data.draft ?? '').trim()
  const channelId = node.data.channelId
  const model = node.data.model
  if (!channelId || !model) {
    notifyError(ports, '技能需要文本模型：请先在创作面板选择平台与模型')
    return 'failed'
  }
  const needsImages = skill.inputMode !== 'text'
  const inputs = needsImages
    ? (promptSpec.collectInputs({ node, graph: ports.graph() }) as NodeInput[])
      .filter((input) => input.kind === 'asset')
    : []
  if (skill.inputMode === 'image' && inputs.length === 0) {
    notifyError(
      ports,
      `技能「${skill.name}」需要上游图片：先把一个已出图的生成节点连到本节点`,
    )
    return 'failed'
  }
  if (skill.inputMode === 'text' && !text) {
    notifyError(ports, `技能「${skill.name}」需要提示词正文：先在本节点写一段内容`)
    return 'failed'
  }

  try {
    const result = await ports.completeText({
      channelId,
      model,
      subjectId: node.id,
      purpose: 'skill',
      system: skill.content,
      text,
      inputs,
      signal,
    })
    ports.dispatch({
      kind: 'node.updateData',
      id: node.id,
      patch: { text: trimToolResult(result) },
      transient: false,
    })
    return 'applied'
  } catch (error) {
    if (signal.aborted) return 'failed'
    const appError = asAppError(error)
    notifyError(
      ports,
      appError
        ? `技能执行失败：${describeError(appError)}`
        : `技能执行失败：${String(error)}`,
    )
    return 'failed'
  }
}

export async function applyComposeFromDraft(
  node: NodeSnapshot<PromptData>,
  signal: AbortSignal,
  ports: CanvasPromptPreparationPorts,
): Promise<PromptPreparationResult> {
  if (signal.aborted) return 'failed'
  const result = await composePromptFromDraft({
    node,
    graph: ports.graph(),
    presetOverrides: ports.presetOverrides,
    signal,
    completeText: ({ channelId, model, system, text, inputs, signal: callSignal }) =>
      ports.completeText({
        channelId,
        model,
        subjectId: node.id,
        purpose: 'compose',
        system,
        text,
        inputs,
        signal: callSignal,
      }),
  })
  if (result.kind === 'skip') return 'none'
  if (result.kind === 'failed') {
    if (!signal.aborted) notifyError(ports, result.message)
    return 'failed'
  }
  ports.dispatch({
    kind: 'node.updateData',
    id: node.id,
    patch: { text: result.text },
    transient: false,
  })
  return 'applied'
}

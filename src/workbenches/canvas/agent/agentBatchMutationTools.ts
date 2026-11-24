import {
  normalizeCanvasBatchSteps,
  type CanvasBatchStep,
} from '../../../domain/agent/mutationSafety'
import { isTopLevelNode } from './agentGeometry'
import { createId } from '../../../shared/id'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'

function validateSteps(
  store: CanvasStore,
  steps: readonly CanvasBatchStep[],
): string[] {
  const graph = store.getSnapshot()
  const deletedNodes = new Set<string>()
  const deletedEdges = new Set<string>()
  const problems: string[] = []
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!
    const at = `第 ${index + 1} 步`
    if (step.op === 'rename') {
      const node = graph.nodes.find((item) => item.id === step.nodeId)
      if (!node) problems.push(`${at}：节点不存在 ${step.nodeId}`)
      else if (deletedNodes.has(step.nodeId)) problems.push(`${at}：节点已在前面删除`)
      continue
    }
    if (step.op === 'move') {
      for (const id of step.nodeIds) {
        const node = graph.nodes.find((item) => item.id === id)
        if (!node) problems.push(`${at}：节点不存在 ${id}`)
        else if (deletedNodes.has(id)) problems.push(`${at}：节点已在前面删除`)
        else if (!isTopLevelNode(node)) {
          problems.push(`${at}：组内节点由容器排版，不能直接移动 ${node.title || id}`)
        }
      }
      continue
    }
    if (step.op === 'deleteEdges') {
      for (const id of step.edgeIds) {
        const edge = graph.edges.find((item) => item.id === id)
        if (!edge) problems.push(`${at}：连线不存在 ${id}`)
        else if (deletedEdges.has(id)) problems.push(`${at}：连线已在前面删除`)
        else if (deletedNodes.has(edge.source) || deletedNodes.has(edge.target)) {
          problems.push(`${at}：连线已随前面删除的节点消失`)
        }
      }
      for (const id of step.edgeIds) deletedEdges.add(id)
      continue
    }
    for (const id of step.nodeIds) {
      if (!graph.nodes.some((item) => item.id === id)) {
        problems.push(`${at}：节点不存在 ${id}`)
      } else if (deletedNodes.has(id)) {
        problems.push(`${at}：节点已在前面删除`)
      }
    }
    for (const id of step.nodeIds) deletedNodes.add(id)
  }
  return problems
}

/**
 * 用一个画布事务完成多项已有节点操作。所有步骤先整批校验，再统一 dispatch；
 * 任意一步校验失败时不碰画布，成功后一次 Undo 可以全部撤回。
 */
export async function applyCanvasBatchInStore(
  store: CanvasStore,
  args: Record<string, unknown>,
) {
  const normalized = normalizeCanvasBatchSteps(args.steps)
  if (!normalized.ok) return { ok: false, problems: normalized.problems }
  const problems = validateSteps(store, normalized.steps)
  if (problems.length > 0) return { ok: false, problems }

  const planId = `agent-batch:${createId('plan')}`
  const transaction = {
    mode: 'multi-step' as const,
    planId,
    label: 'Agent 批量修改画布',
  }
  try {
    for (const step of normalized.steps) {
      if (step.op === 'rename') {
        store.dispatch(
          { kind: 'node.rename', id: step.nodeId, title: step.title },
          transaction,
        )
      } else if (step.op === 'move') {
        store.dispatch(
          {
            kind: 'node.move',
            ids: step.nodeIds,
            dx: step.dx,
            dy: step.dy,
            phase: 'end',
          },
          transaction,
        )
      } else if (step.op === 'deleteEdges') {
        for (const id of step.edgeIds) {
          store.dispatch({ kind: 'edge.remove', id }, transaction)
        }
      } else {
        store.dispatch({ kind: 'node.delete', ids: step.nodeIds }, transaction)
      }
    }
    await store.flush()
    return {
      ok: true,
      appliedSteps: normalized.steps.length,
      steps: normalized.steps,
    }
  } catch (error) {
    store.undo()
    await store.flush().catch(() => undefined)
    return {
      ok: false,
      problems: [
        `批量修改失败，已回滚：${error instanceof Error ? error.message : String(error)}`,
      ],
    }
  }
}

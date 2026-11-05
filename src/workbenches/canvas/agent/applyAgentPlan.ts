import {
  verifyAgentPlanLanding,
  type AgentGraphView,
  type Rect,
} from '../../../domain/agent/landing'
import type { AgentPlan } from '../../../domain/agent/plan'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { GenerationContextAsset } from '../../../domain/canvas/model/node'
import { toWorldRectInGraph } from '../../../domain/canvas/geometry/coords'
import { createId } from '../../../shared/id'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import { buildLandingCommand } from './buildLandingCommand'

/**
 * 落一份 agent 计划到画布，**并立刻回读自检**（设计文档 §3 / §6.1）。
 *
 * 这是「计划变成画布上的图」真正发生的地方，也是用户要求的那个关口的实现：
 * 用户 2026-10-01「每次落地完，我需要你验证」。
 *
 * 为什么把「落地」与「自检」写在同一个函数里，而不是让调用方记得去验：
 * 分成两步就会有调用点漏掉自检 —— 而漏掉时**什么都不会报错**，
 * 只是「图没长对」这件事再次静默溜过去。合成一个入口，漏不掉。
 */

export interface ApplyAgentPlanResult {
  /** 自检是否通过 */
  ok: boolean
  /** 逐条问题（`ok:true` 时为空） */
  problems: string[]
  /** 本次新建的节点 id —— 界面据此高亮/选中，让你一眼看到它建了什么 */
  createdNodeIds: string[]
  /** 计划临时 id → 真实节点 id；模型执行 runNode / runFrom 时必须用 nodeId */
  resolvedNodes: {
    localId: string
    nodeId: string
    type: AgentPlan['nodes'][number]['type']
    title?: string
    created: boolean
  }[]
}

/** 图快照 → 自检要的视图（只保留它关心的字段） */
export function toGraphView(graph: GraphSnapshot): AgentGraphView {
  return {
    nodes: graph.nodes.map((n) => {
      const rect = toWorldRectInGraph(n, graph)
      return {
        id: n.id,
        type: n.type,
        ...(n.title ? { title: n.title } : {}),
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
      }
    }),
    edges: graph.edges.map((e) => ({
      source: e.source,
      target: e.target,
      ...(e.sourcePort ? { sourcePort: e.sourcePort } : {}),
      ...(e.targetPort ? { targetPort: e.targetPort } : {}),
    })),
  }
}

export function applyAgentPlan(
  store: CanvasStore,
  plan: AgentPlan,
  origin: { x: number; y: number },
  /**
   * 新建节点的默认数据（渠道 + 模型 + 生成参数），由调用方从渠道 store 解好传进来。
   * 不传也能跑，但那样建出来的生成节点没渠道没模型 —— 点了生成只会得到一句
   * 「还没选择渠道」。所以这条链上**必须**由调用方传（见 buildLandingCommand 的 dataFor）。
   */
  opts?: {
    /** 第二个参数是**那个节点本身**：图片 / 视频两档模型要按 `data.mode` 选（见 buildLandingCommand） */
    dataFor?: (
      type: AgentPlan['nodes'][number]['type'],
      node: AgentPlan['nodes'][number],
    ) => Record<string, unknown>
    explicitFor?: (
      type: AgentPlan['nodes'][number]['type'],
      node: AgentPlan['nodes'][number],
    ) => Record<string, unknown>
    contextAssetsFor?: (
      type: AgentPlan['nodes'][number]['type'],
      node: AgentPlan['nodes'][number],
    ) => readonly GenerationContextAsset[] | undefined
    viewportWorld?: Rect
  },
): ApplyAgentPlanResult {
  const graph = store.getSnapshot()
  const before = toGraphView(graph)

  const { command, idOf } = buildLandingCommand({
    plan,
    graph,
    origin,
    ...(opts?.viewportWorld ? { viewportWorld: opts.viewportWorld } : {}),
    newId: () => createId('node'),
    ...(opts?.dataFor ? { dataFor: opts.dataFor } : {}),
    ...(opts?.explicitFor ? { explicitFor: opts.explicitFor } : {}),
    ...(opts?.contextAssetsFor ? { contextAssetsFor: opts.contextAssetsFor } : {}),
  })
  if (command.nodes.length === 0) {
    return {
      ok: false,
      problems: [
        '这份计划没有产生任何新建节点。',
        '如果要在已有参考图上继续设计，请至少新建一个生成节点，并在 attach 中引用原图；不要提交只有复用节点的空计划。',
      ],
      createdNodeIds: [],
      resolvedNodes: plan.nodes.flatMap((node) => {
        const nodeId = idOf[node.localId]
        return nodeId
          ? [
              {
                localId: node.localId,
                nodeId,
                type: node.type,
                ...(node.title ? { title: node.title } : {}),
                created: false,
              },
            ]
          : []
      }),
    }
  }

  // 一次 dispatch = 一个 standalone 事务 = 一次撤销全回退
  store.dispatch(command)

  const after = toGraphView(store.getSnapshot())
  const check = verifyAgentPlanLanding({ plan, idOf, before, after })
  const createdIds = new Set(command.nodes.map((n) => n.id))
  if (!check.ok) {
    /**
     * 自检失败时**不能留下半成品**。`applyPlan` 的“一次 dispatch”只保证用户
     * 事后点一次撤销能全退，不等于系统自己已经回滚；此前这里在自检失败后直接
     * 返回 `ok:false`，画布却已经多了节点和连线，界面于是说“没建成”，后续读取
     * 又能看到那个节点。
     *
     * 紧邻 dispatch 调用 `undo()`，中间没有 await，因此撤掉的必然是刚提交的
     * 这一组。回滚后再按图快照核对一次；若仍不一致，必须如实报告，不能假装干净。
     */
    store.undo()
    const rolledBack =
      JSON.stringify(toGraphView(store.getSnapshot())) ===
      JSON.stringify(before)
    if (!rolledBack) {
      return {
        ok: false,
        problems: [
          ...check.problems,
          '落地自检失败后自动回滚也没有恢复原画布，请先撤销本次操作并检查画布。',
        ],
        createdNodeIds: [...createdIds],
        resolvedNodes: [],
      }
    }
    return {
      ok: false,
      problems: check.problems,
      createdNodeIds: [],
      resolvedNodes: [],
    }
  }

  return {
    ok: check.ok,
    problems: check.problems,
    createdNodeIds: [...createdIds],
    resolvedNodes: plan.nodes.flatMap((node) => {
      const nodeId = idOf[node.localId]
      if (!nodeId) return []
      return [
        {
          localId: node.localId,
          nodeId,
          type: node.type,
          ...(node.title ? { title: node.title } : {}),
          created: createdIds.has(nodeId),
        },
      ]
    }),
  }
}

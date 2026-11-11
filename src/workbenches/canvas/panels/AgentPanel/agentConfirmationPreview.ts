import {
  channelIdForLogical,
  type CatalogChannelLike,
} from '../../../../domain/project/modelCatalog'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
import { runFromNodeIds } from '../../agent/tools'
import type { AgentPanelStatus } from './AgentActivityViews'
import { readableConfirmationLines } from './conversation'

export interface AgentConfirmationPreview {
  tool: string
  title: string
  lines: string[]
  action: string
}

type GraphReader = Pick<CanvasStore, 'getSnapshot'>
/** 确认卡只需要渠道的名字与选路字段 */
export type PreviewChannel = CatalogChannelLike & { name: string }

/**
 * 运行确认卡逐节点写明「渠道 · 模型」（Agent 实测 Bug A6：卡片不显示渠道 / 模型，
 * 用户看不出会用哪个模型花钱）。渠道按与执行同一条选路（启用渠道里能提供该模型的，
 * 同优先度时偏好节点上记录的渠道）解析。
 */
function runRouteLine(title: string, data: unknown, channels: readonly PreviewChannel[]): string {
  const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const model = typeof row.model === 'string' ? row.model.trim() : ''
  const owned = typeof row.channelId === 'string' ? row.channelId : undefined
  const enabled = channels.filter((channel) => channel.enabled)
  const channelId = model ? channelIdForLogical(enabled, model, owned) : undefined
  const channelName = enabled.find((channel) => channel.id === channelId)?.name
  return `「${title}」：渠道 ${channelName ?? '未找到可用渠道'} · 模型 ${model || '未选择'}`
}

/**
 * 确认卡里要显示什么，必须在花钱和写画布之前说清楚。
 *
 * 保持为纯展示适配器：只读取当前状态和画布快照，不执行工具、不修改 store。
 */
export function previewOf(
  status: AgentPanelStatus,
  store: GraphReader,
  channels: readonly PreviewChannel[] = [],
): AgentConfirmationPreview | null {
  if (status.kind !== 'awaitingConfirm') return null
  const { name, args } = status.request
  const a = (args ?? {}) as Record<string, unknown>
  if (name === 'proposeTaskPlan') {
    const title = typeof a.title === 'string' ? a.title.trim() : '执行计划'
    const summary = typeof a.summary === 'string' ? a.summary.trim() : ''
    const assumptions = Array.isArray(a.assumptions)
      ? a.assumptions
          .filter((value): value is string => typeof value === 'string')
          .flatMap((value) => readableConfirmationLines(value))
      : []
    const steps = Array.isArray(a.steps)
      ? a.steps.flatMap((value, index) => {
          if (!value || typeof value !== 'object') return []
          const row = value as Record<string, unknown>
          const stepTitle = typeof row.title === 'string' ? row.title.trim() : ''
          if (!stepTitle) return []
          const detail = typeof row.detail === 'string' ? row.detail.trim() : ''
          return [
            `${index + 1}. ${stepTitle}${
              row.requiresConfirmation !== false ? '（完成需验收）' : ''
            }`,
            ...(detail
              ? readableConfirmationLines(detail).map((line) => `   产出：${line}`)
              : []),
          ]
        })
      : []
    return {
      tool: name,
      title: '确认这套执行计划？',
      lines: [
        title,
        ...(summary ? [summary] : []),
        ...(assumptions.length > 0
          ? ['计划前提（请核对）：', ...assumptions.map((line) => `· ${line}`)]
          : []),
        ...steps,
        '确认后才会开始执行；每一步完成后都会停下来等你验收。',
      ],
      action: '确认计划',
    }
  }
  if (name === 'requestTaskConfirmation') {
    const question =
      typeof a.question === 'string' && a.question.trim()
        ? a.question.trim()
        : '这一步需要你确认'
    const detail = typeof a.detail === 'string' ? a.detail.trim() : ''
    return {
      tool: name,
      title: question,
      lines: readableConfirmationLines(detail),
      action: a.purpose === 'review' ? '结果满意，继续' : '确认并继续',
    }
  }
  if (name === 'runNode') {
    const ids = Array.isArray(a.nodeIds)
      ? a.nodeIds.filter((id): id is string => typeof id === 'string')
      : []
    const nodes = ids.flatMap((id) => {
      const node = store.getSnapshot().nodes.find((item) => item.id === id)
      return node ? [node] : []
    })
    const titleOf = (node: (typeof nodes)[number]) => node.title ?? '未命名'
    return {
      tool: name,
      /* 多节点时标题列出全部节点（A6：实测只写第一个却跑 3 个） */
      title: nodes.length > 0
        ? `是否运行节点${nodes.map((node) => `「${titleOf(node)}」`).join('')}生成图片？`
        : '要开始生成',
      lines: [
        ...nodes.map((node) => runRouteLine(titleOf(node), node.data, channels)),
        `跑 ${ids.length} 个节点（会花钱）`,
      ],
      action: '批准运行',
    }
  }
  if (name === 'runFrom') {
    const resolved = runFromNodeIds(store, a.nodeIds)
    if (!resolved.ok) {
      return {
        tool: name,
        title: '这条下游链不能运行',
        lines: resolved.problems,
        action: '知道了',
      }
    }
    const names = resolved.ids.map((id) => {
      const node = store.getSnapshot().nodes.find((item) => item.id === id)
      return node?.title || id
    })
    return {
      tool: name,
      title: '要把这条下游流程跑完？',
      lines: [`将运行 ${resolved.ids.length} 个节点：${names.join(' → ')}`, '会花钱'],
      action: '批准运行',
    }
  }
  if (name === 'rememberMemory') {
    const kindLabels: Record<string, string> = {
      preference: '偏好',
      fact: '事实',
      constraint: '硬约束',
      decision: '已确认决定',
    }
    const scopeLabels: Record<string, string> = {
      global: '全部工作台',
      workbench: '当前工作台',
      project: '当前项目',
      session: '当前会话',
    }
    const text = typeof a.text === 'string' ? a.text : ''
    return {
      tool: name,
      title: '要把这条内容记成长期记忆？',
      lines: [
        text,
        `类型：${kindLabels[String(a.kind)] ?? String(a.kind)}`,
        `作用范围：${scopeLabels[String(a.scope)] ?? String(a.scope)}`,
        ...(typeof a.key === 'string' && a.key ? [`主题：${a.key}`] : []),
        '一次性要求不会被保存；以后可在“全局设置 → Agent 与记忆”修改或忘记。',
      ].filter(Boolean),
      action: '保存记忆',
    }
  }
  if (name === 'updateNode') {
    const nodeIds = Array.isArray(a.nodeIds)
      ? a.nodeIds.filter((id): id is string => typeof id === 'string')
      : typeof a.nodeId === 'string'
        ? [a.nodeId]
        : []
    const names = nodeIds.map(
      (id) => store.getSnapshot().nodes.find((node) => node.id === id)?.title || id,
    )
    return {
      tool: name,
      title: '要改节点参数',
      lines: [
        names.length > 0 ? `节点：${names.join('、')}` : '没有指定节点',
        ...Object.keys((a.data ?? {}) as object).map((key) => `改 ${key}`),
      ],
      action: '应用改动',
    }
  }
  if (name === 'deleteEdges') {
    const graph = store.getSnapshot()
    const ids = Array.isArray(a.edgeIds)
      ? a.edgeIds.filter((id): id is string => typeof id === 'string')
      : []
    const pairs = Array.isArray(a.pairs)
      ? a.pairs.flatMap((pair) => {
          if (!pair || typeof pair !== 'object') return []
          const row = pair as Record<string, unknown>
          return typeof row.source === 'string' && typeof row.target === 'string'
            ? [{ source: row.source, target: row.target }]
            : []
        })
      : []
    const edges = graph.edges.filter(
      (edge) =>
        ids.includes(edge.id) ||
        pairs.some(
          (pair) => pair.source === edge.source && pair.target === edge.target,
        ),
    )
    const titleOf = (id: string) =>
      graph.nodes.find((node) => node.id === id)?.title || id
    return {
      tool: name,
      title: `要取消 ${edges.length} 条连线？`,
      lines:
        edges.length > 0
          ? edges.map((edge) => `${titleOf(edge.source)} → ${titleOf(edge.target)}`)
          : ['没有找到可取消的连线'],
      action: '取消这些连线',
    }
  }
  if (name === 'deleteNodes') {
    const ids = Array.isArray(a.nodeIds)
      ? a.nodeIds.filter((id): id is string => typeof id === 'string')
      : []
    const graph = store.getSnapshot()
    const names = ids.map(
      (id) => graph.nodes.find((node) => node.id === id)?.title || id,
    )
    return {
      tool: name,
      title: `要删除 ${names.length} 个节点？`,
      lines: [...names, '关联连线会一并删除，素材库里的图片文件不受影响。'],
      action: '删除这些节点',
    }
  }
  return { tool: name, title: name, lines: [], action: '执行' }
}

import type { AgentNodeType } from '../../../domain/agent/plan'
import { asRecord } from './canvasReadTools'

/**
 * **连线端点补全**（A8，2026-11-11 Agent 真机实测：「attach 端点校验失败，模型自修」）。
 *
 * 校验只认 `nodes[]` 里的 localId，于是两种**语义确定**的写法会被整份退回：
 * ① `attach` 里写了 `ref1 → 画布节点`、edges 用 `ref1` 当端点，却没在 `nodes[]` 再抄一行；
 * ② 本轮前一次 `applyPlan` 建好的 localId（如 `v1`），在下一份计划里直接当端点。
 *
 * 两者都只在**能对上画布上的真节点**时补：给 ① 补一行复用节点；给 ② 经别名表
 * （`resolveNodeIds`）解析出真实 id 后补一条 attach + 一行复用节点。对不上的照旧交给校验报错，
 * 计划自己声明过的 localId 永远以计划为准（`resolveNodeIds` 只解析计划里没声明的端点）。
 * 补出来的行在归一化之后加，`order` 记 0（复用节点不新建，布局不看它）。
 */
export function completeEndpointRows(
  raw: unknown,
  existing: ReadonlyMap<string, AgentNodeType>,
  resolveNodeIds?: (ids: readonly string[]) => string[],
): unknown {
  const row = asRecord(raw)
  if (!Array.isArray(row.nodes)) return raw
  const declared = new Set(
    row.nodes.flatMap((item) => {
      const id = asRecord(item).localId
      return typeof id === 'string' && id ? [id] : []
    }),
  )
  const attach = (Array.isArray(row.attach) ? row.attach : []).map(asRecord)
  const extraNodes: Record<string, unknown>[] = []
  const extraAttach: Record<string, unknown>[] = []
  const addRow = (localId: string, existingNodeId: string) => {
    declared.add(localId)
    extraNodes.push({ localId, type: existing.get(existingNodeId), data: {}, order: 0 })
  }
  for (const entry of attach) {
    const localId = typeof entry.localId === 'string' ? entry.localId : ''
    const target = typeof entry.existingNodeId === 'string' ? entry.existingNodeId : ''
    if (localId && !declared.has(localId) && existing.has(target)) addRow(localId, target)
  }
  const attachedLocalIds = new Set(attach.map((entry) => entry.localId))
  const edges = (Array.isArray(row.edges) ? row.edges : []).map(asRecord)
  for (const edge of edges) {
    for (const end of [edge.source, edge.target]) {
      if (typeof end !== 'string' || !end || declared.has(end) || attachedLocalIds.has(end)) continue
      const realId = resolveNodeIds?.([end])[0]
      if (!realId || !existing.has(realId)) continue
      addRow(end, realId)
      extraAttach.push({ localId: end, existingNodeId: realId })
    }
  }
  if (extraNodes.length === 0) return raw
  return {
    ...row,
    nodes: [...row.nodes, ...extraNodes],
    ...(attach.length > 0 || extraAttach.length > 0 ? { attach: [...attach, ...extraAttach] } : {}),
  }
}

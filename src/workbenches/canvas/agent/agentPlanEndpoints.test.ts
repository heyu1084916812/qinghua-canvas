import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import { createMemoryPlatform } from '../../../platform/memory'
import { createCanvasStore, type CanvasStore } from '../../../state/workbenches/canvas/store'
import { planProblems } from './agentPlanGate'
import { executeConfirmedTool, type AgentToolContext } from './tools'

/**
 * A8（2026-11-11 Agent 真机实测）：attach 的 localId 不能直接做连线端点。
 *
 * 模型写了 `attach: [{ localId: 'ref1', existingNodeId }]` 并在 edges 里用 `ref1` 当起点，
 * 但没在 `nodes[]` 里再抄一行 `ref1` —— 原先整份被判「起点不在计划里 / attach 的 localId
 * 不在计划里」退回，模型只能自己猜着修。同理，**本轮上一次 applyPlan 新建的 localId**
 * 在下一份计划里当端点也解析不了。两者都是确定性可补的：端点能对上画布上的真节点，
 * 就补一行复用节点（attach），而不是让整份计划失败。
 */

beforeEach(() => registerAllSpecs())

function setup() {
  const store: CanvasStore = createCanvasStore({
    platform: createMemoryPlatform() as never,
    projectId: 'p1',
  })
  const runNodes = vi.fn(async (ids: string[]) => ids.map((nodeId) => ({ nodeId, ok: true })))
  const ctx: AgentToolContext = { store, origin: { x: 0, y: 0 }, runNodes }
  return { store, ctx }
}

const addNode = (store: CanvasStore, type: 'prompt' | 'generation', data: Record<string, unknown> = {}) => {
  store.dispatch({ kind: 'node.create', projectId: 'p1', type, at: { x: 0, y: 0 }, data })
  return store.getSnapshot().nodes.at(-1)!.id
}

describe('planProblems · attach / 本轮 localId 当连线端点（A8）', () => {
  it('★★ attach 的 localId 没写进 nodes[] 也能当连线起点：补一行复用节点', () => {
    const r = planProblems(
      {
        summary: '在原图基础上改标题',
        nodes: [{ localId: 'v1', type: 'generation', data: { prompt: '标题放大，背景浅米色' }, order: 1 }],
        edges: [{ source: 'ref1', target: 'v1' }],
        attach: [{ localId: 'ref1', existingNodeId: 'n-old' }],
      },
      [{ id: 'n-old', type: 'generation' }],
    )
    expect(r.problems).toEqual([])
    expect(r.plan?.nodes.find((n) => n.localId === 'ref1')).toMatchObject({ type: 'generation' })
    expect(r.plan?.attach).toEqual([{ localId: 'ref1', existingNodeId: 'n-old' }])
    expect(r.plan?.edges).toContainEqual(expect.objectContaining({ source: 'ref1', target: 'v1' }))
  })

  it('★★ 本轮前一次 applyPlan 新建的 localId 当端点：经别名解析成复用节点', () => {
    const r = planProblems(
      {
        summary: '补一张延展图',
        nodes: [{ localId: 'v2', type: 'generation', data: { prompt: '同风格横版' }, order: 1 }],
        edges: [{ source: 'v1', target: 'v2' }],
      },
      [{ id: 'n-real', type: 'generation' }],
      (ids) => ids.map((id) => (id === 'v1' ? 'n-real' : id)),
    )
    expect(r.problems).toEqual([])
    expect(r.plan?.attach).toEqual([{ localId: 'v1', existingNodeId: 'n-real' }])
    expect(r.plan?.nodes.find((n) => n.localId === 'v1')).toMatchObject({ type: 'generation' })
  })

  it('★ 解析不到画布真节点的端点照旧报错（不编节点）', () => {
    const r = planProblems(
      {
        summary: '连到不存在的节点',
        nodes: [{ localId: 'v2', type: 'generation', data: { prompt: 'x' }, order: 0 }],
        edges: [{ source: 'ghost', target: 'v2' }],
      },
      [{ id: 'n-real', type: 'generation' }],
      (ids) => ids.map((id) => (id === 'ghost' ? 'n-deleted' : id)),
    )
    expect(r.plan).toBeNull()
    expect(r.problems.join('\n')).toContain('起点不在计划里：ghost')
  })

  it('★ attach 指向画布上不存在的节点时不补行，照旧报 existingNodeId 不在画布上', () => {
    const r = planProblems(
      {
        summary: 'x',
        nodes: [{ localId: 'v1', type: 'generation', data: { prompt: 'x' }, order: 1 }],
        edges: [{ source: 'ref1', target: 'v1' }],
        attach: [{ localId: 'ref1', existingNodeId: 'n-missing' }],
      },
      [{ id: 'n-old', type: 'generation' }],
    )
    expect(r.plan).toBeNull()
    expect(r.problems.join('\n')).toContain('n-missing')
  })

  it('★ 计划自己声明了同名节点时以计划为准，不被别名覆盖', () => {
    const r = planProblems(
      {
        summary: '新建 v1',
        nodes: [
          { localId: 'p', type: 'prompt', data: { text: '海报' }, order: 0 },
          { localId: 'v1', type: 'generation', data: {}, order: 1 },
        ],
        edges: [{ source: 'p', target: 'v1' }],
      },
      [{ id: 'n-real', type: 'generation' }],
      (ids) => ids.map((id) => (id === 'v1' ? 'n-real' : id)),
    )
    expect(r.problems).toEqual([])
    expect(r.plan?.attach ?? []).toEqual([])
  })
})

describe('applyPlan · 连到本轮前一份计划的节点（A8 端到端）', () => {
  it('★★ 第二份计划用第一份的 localId 当起点：真连线落在已有节点上，不重复新建', async () => {
    const { store, ctx } = setup()
    const first = addNode(store, 'generation', { mode: 'image', prompt: '咖啡店海报', assetHash: 'h1' })
    const aliases = new Map([['v1', first]])
    const result = (await executeConfirmedTool(
      'applyPlan',
      {
        summary: '在海报基础上改标题',
        nodes: [{ localId: 'v2', type: 'generation', data: { mode: 'image', prompt: '标题更大' }, order: 1 }],
        edges: [{ source: 'v1', target: 'v2' }],
      },
      { ...ctx, resolveNodeIds: (ids) => ids.map((id) => aliases.get(id) ?? id) },
    )) as { ok: boolean; problems?: string[]; createdNodeIds: string[] }
    expect(result.problems ?? []).toEqual([])
    expect(result.ok).toBe(true)
    const snap = store.getSnapshot()
    expect(snap.nodes).toHaveLength(2)
    const created = result.createdNodeIds[0]!
    expect(snap.edges.some((e) => e.source === first && e.target === created)).toBe(true)
  })
})

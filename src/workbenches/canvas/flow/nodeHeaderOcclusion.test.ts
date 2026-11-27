import { describe, expect, it } from 'vitest'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { nodeHeaderLabels } from './nodeHeaders'
import { nodeHeaderOcclusions } from './nodeHeaderOcclusion'

function node(overrides: Partial<NodeSnapshot>): NodeSnapshot {
  return {
    id: 'n1',
    projectId: 'p1',
    type: 'generation',
    title: '图片节点',
    x: 0,
    y: 0,
    w: 240,
    h: 192,
    parentId: null,
    data: {},
    disabled: false,
    ...overrides,
  } as NodeSnapshot
}

describe('nodeHeaderOcclusions', () => {
  it('leaves non-overlapping headers unclipped', () => {
    const nodes = [
      node({ id: 'a', x: 0, y: 100 }),
      node({ id: 'b', x: 400, y: 100 }),
    ]
    const labels = nodeHeaderLabels(nodes)
    const map = nodeHeaderOcclusions(labels, nodes, [])
    expect(map.get('a')?.hidden).toBe(false)
    expect(map.get('a')?.clipPath).toBeUndefined()
    expect(map.get('b')?.hidden).toBe(false)
    expect(map.get('b')?.clipPath).toBeUndefined()
  })

  it('hides the lower node header when completely covered by a higher-stacked node', () => {
    const nodes = [
      node({ id: 'lower', x: 100, y: 100, w: 200, h: 160 }),
      // 上层节点覆盖 lower 顶部标题区（y: 76..98）
      node({ id: 'upper', x: 80, y: 50, w: 260, h: 160 }),
    ]
    const labels = nodeHeaderLabels(nodes)
    const map = nodeHeaderOcclusions(labels, nodes, [])
    expect(map.get('lower')?.hidden).toBe(true)
    expect(map.get('upper')?.hidden).toBe(false)
    expect(map.get('upper')?.clipPath).toBeUndefined()
  })

  it('clips only the covered portion when a higher node partially overlaps a lower header', () => {
    const nodes = [
      node({ id: 'lower', x: 100, y: 100, w: 200, h: 160 }),
      // 只盖住 lower 标题的右半部分（x >= 200）
      node({ id: 'upper', x: 200, y: 50, w: 200, h: 160 }),
    ]
    const labels = nodeHeaderLabels(nodes)
    const map = nodeHeaderOcclusions(labels, nodes, [])
    const occ = map.get('lower')
    expect(occ?.hidden).toBe(false)
    expect(occ?.clipPath).toMatch(/^path\("M0 0H108V22H0Z"\)$/)
  })

  it('elevates selected nodes above later unselected nodes', () => {
    const nodes = [
      node({ id: 'first', x: 80, y: 50, w: 260, h: 160 }),
      node({ id: 'second', x: 100, y: 100, w: 200, h: 160 }),
    ]
    const labels = nodeHeaderLabels(nodes)

    // 未选中时 second 在上，不遮挡自己、也不被 first 遮挡
    const unselected = nodeHeaderOcclusions(labels, nodes, [])
    expect(unselected.get('second')?.hidden).toBe(false)
    expect(unselected.get('second')?.clipPath).toBeUndefined()

    // 选中 first 后，first 置顶盖住 second 的标题
    const selectedFirst = nodeHeaderOcclusions(labels, nodes, ['first'])
    expect(selectedFirst.get('second')?.hidden).toBe(true)
    expect(selectedFirst.get('first')?.hidden).toBe(false)
    expect((selectedFirst.get('first')?.zIndex ?? 0)).toBeGreaterThan(
      selectedFirst.get('second')?.zIndex ?? 0,
    )
  })

  it('never lets a parent group background occlude its own child header', () => {
    const nodes = [
      node({ id: 'group', type: 'group', x: 0, y: 0, w: 500, h: 400 }),
      node({ id: 'child', parentId: 'group', x: 40, y: 60, w: 200, h: 160 }),
    ]
    const labels = nodeHeaderLabels(nodes)
    const map = nodeHeaderOcclusions(labels, nodes, [])
    expect(map.get('child')?.hidden).toBe(false)
    expect(map.get('child')?.clipPath).toBeUndefined()
  })
})

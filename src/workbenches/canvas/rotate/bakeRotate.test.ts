import { describe, expect, it } from 'vitest'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { assetNodeSize } from '../../../domain/canvas/layout/assetNodeSize'
import { rotatedResultCommands } from './bakeRotate'

function sourceGraph(): { graph: GraphSnapshot; node: NodeSnapshot } {
  const node = {
    id: 'source',
    projectId: 'project-1',
    type: 'generation',
    parentId: null,
    x: 10,
    y: 20,
    w: 360,
    h: 240,
    title: '原图',
    disabled: false,
    data: { mode: 'image', assetHash: 'old-hash' },
  } as NodeSnapshot
  return {
    node,
    graph: { projectId: 'project-1', nodes: [node], edges: [] } as GraphSnapshot,
  }
}

describe('rotatedResultCommands', () => {
  it('只有保存事务才创建副本、连线并改写副本数据', () => {
    const { graph, node } = sourceGraph()
    const commands = rotatedResultCommands({
      graph,
      node,
      newId: 'rotated',
      newHash: 'new-hash',
      bytes: new Uint8Array([1, 2, 3]),
      width: 240,
      height: 360,
      createdAt: 123,
    })

    expect(commands.map((command) => command.kind)).toEqual([
      'asset.put',
      'node.duplicate',
      'edge.connect',
      'node.updateData',
      'node.resize',
    ])
    expect(commands[1]).toMatchObject({
      kind: 'node.duplicate',
      ids: ['source'],
      newIds: ['rotated'],
      dx: 400,
      dy: 0,
      rewire: false,
    })
    expect(commands[2]).toMatchObject({
      kind: 'edge.connect',
      source: 'source',
      target: 'rotated',
    })
    expect(commands[3]).toMatchObject({
      kind: 'node.updateData',
      id: 'rotated',
      patch: {
        assetHash: 'new-hash',
        naturalSize: { width: 240, height: 360 },
        thumbOrder: ['new-hash'],
      },
    })
    expect(commands[4]).toMatchObject({
      kind: 'node.resize',
      id: 'rotated',
      rect: {
        x: 410 + (360 - assetNodeSize({ width: 240, height: 360 }).w) / 2,
        y: 20 + (240 - assetNodeSize({ width: 240, height: 360 }).h) / 2,
      },
    })
    expect(commands.some((command) =>
      (command.kind === 'node.updateData' || command.kind === 'node.resize') &&
      command.id === 'source',
    )).toBe(false)
  })
})

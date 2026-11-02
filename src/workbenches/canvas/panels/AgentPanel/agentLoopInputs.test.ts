import { describe, expect, it } from 'vitest'
import type { NodeSnapshot } from '../../../../domain/canvas/model/node'
import { collectAgentLoopInputs } from './agentLoopInputs'

function nodeWith(
  id: string,
  data: {
    assetHash?: string
    assetMime?: string
    naturalSize?: { width: number; height: number }
  },
): NodeSnapshot {
  return {
    id,
    projectId: 'p1',
    type: 'generation',
    parentId: null,
    x: 0,
    y: 0,
    w: 240,
    h: 180,
    title: id,
    disabled: false,
    data: {
      mode: 'image',
      prompt: '',
      linkedPromptNodeIds: [],
      channelId: '',
      model: '',
      thumbOrder: [],
      upstreamHidden: [],
      ...data,
    },
  } as NodeSnapshot
}

describe('collectAgentLoopInputs', () => {
  it('★★ 同一节点 id 重复引用只发一次，并保持首次顺序', () => {
    const nodes = [
      nodeWith('img-a', { assetHash: 'hash-a' }),
      nodeWith('img-b', { assetHash: 'hash-b' }),
    ]
    const inputs = collectAgentLoopInputs(nodes, [
      'img-a',
      'img-b',
      'img-a',
    ])
    expect(inputs).toEqual([
      {
        kind: 'asset',
        nodeId: 'img-a',
        assetHash: 'hash-a',
        mime: 'image/png',
      },
      {
        kind: 'asset',
        nodeId: 'img-b',
        assetHash: 'hash-b',
        mime: 'image/png',
      },
    ])
  })

  it('★★ 缺 assetMime 的旧节点回落 image/png，有 MIME 时如实带上', () => {
    const nodes = [
      nodeWith('old', { assetHash: 'hash-old' }),
      nodeWith('new', {
        assetHash: 'hash-new',
        assetMime: 'image/webp',
      }),
    ]
    const inputs = collectAgentLoopInputs(nodes, ['old', 'new'])
    expect(inputs[0]).toMatchObject({ nodeId: 'old', mime: 'image/png' })
    expect(inputs[1]).toMatchObject({ nodeId: 'new', mime: 'image/webp' })
  })

  it('★★ 没有 assetHash 的节点不进视觉输入', () => {
    const nodes = [
      nodeWith('empty', {}),
      nodeWith('missing', { assetMime: 'image/png' }),
      nodeWith('ok', { assetHash: 'hash-ok' }),
    ]
    const inputs = collectAgentLoopInputs(nodes, [
      'empty',
      'missing',
      'ok',
      'ghost',
    ])
    expect(inputs).toEqual([
      {
        kind: 'asset',
        nodeId: 'ok',
        assetHash: 'hash-ok',
        mime: 'image/png',
      },
    ])
  })

  it('★★ naturalSize 只在节点记录过时出现', () => {
    const nodes = [
      nodeWith('sized', {
        assetHash: 'hash-sized',
        naturalSize: { width: 1024, height: 768 },
      }),
      nodeWith('plain', { assetHash: 'hash-plain' }),
    ]
    const inputs = collectAgentLoopInputs(nodes, ['sized', 'plain'])
    expect(inputs[0]).toMatchObject({
      naturalSize: { width: 1024, height: 768 },
    })
    expect(inputs[1]).not.toHaveProperty('naturalSize')
  })

  it('★★ context 套件素材按 hash 去重并追加为 context-kit 输入', () => {
    const nodes = [
      nodeWith('img-a', { assetHash: 'hash-a', assetMime: 'image/png' }),
    ]
    const inputs = collectAgentLoopInputs(
      nodes,
      ['img-a'],
      [
        { hash: 'hash-a', mime: 'image/png', role: 'logo', name: '同图' },
        { hash: 'kit-1', mime: 'image/webp', role: 'logo', name: 'Logo' },
        { hash: 'kit-1', mime: 'image/webp', role: 'logo', name: '重复' },
      ],
    )
    expect(inputs).toEqual([
      {
        kind: 'asset',
        nodeId: 'img-a',
        assetHash: 'hash-a',
        mime: 'image/png',
      },
      {
        kind: 'asset',
        nodeId: 'context-kit:kit-1',
        assetHash: 'kit-1',
        mime: 'image/webp',
      },
    ])
  })
})

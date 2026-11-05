import { describe, expect, it } from 'vitest'
import { emptyStoryboard, type StoryboardShot } from './model'
import {
  ASSET_BLOCK_HEADER,
  assetBasePrompt,
  assetsOfShot,
  characterNamesOf,
  planShotRefEdges,
  sceneNameOf,
  shotPrompt,
  shotPromptWithAssets,
  shotRefNodeIds,
  shotVideoPrompt,
  storyboardStats,
} from './presentation'

const shot: StoryboardShot = {
  id: 'sh1',
  episodeId: 'ep1',
  scene: '客厅',
  lines: [],
  durationSec: 4,
  prompt: '',
  sceneId: 's1',
  characterIds: ['c2', 'c1'],
}

describe('storyboard · 展示与提示词投影', () => {
  it('未绑定资产时导出提示词逐字等于 shotPrompt', () => {
    expect(shotPrompt(shot)).toBe('客厅')
    expect(shotPromptWithAssets(emptyStoryboard('p1'), shot)).toBe('客厅')
    expect(shotVideoPrompt(emptyStoryboard('p1'), shot)).toContain('自然、连续的镜头运动')
    expect(ASSET_BLOCK_HEADER).toContain('不要画进画面')
    expect(ASSET_BLOCK_HEADER.endsWith('：')).toBe(true)
  })

  it('绑定资产后场景优先、角色按库序，参考图节点与断线都有固定顺序', () => {
    const doc = {
      ...emptyStoryboard('p1'),
      characters: [
        { id: 'c1', name: '甲', description: '红衣', aliases: [] },
        { id: 'c2', name: '乙', description: '', aliases: [] },
      ],
      scenes: [{ id: 's1', name: '街道', description: '积水', aliases: [] }],
      shots: [shot],
    }
    const prompt = shotPromptWithAssets(doc, shot)
    expect(prompt).toContain('场景「街道」：积水')
    expect(prompt).toContain(ASSET_BLOCK_HEADER)
    expect(prompt.indexOf('角色「甲」')).toBeLessThan(prompt.indexOf('角色「乙」'))
    expect(sceneNameOf(doc, shot)).toBe('街道')
    expect(characterNamesOf(doc, shot)).toEqual(['甲', '乙'])
    expect(assetsOfShot(doc, shot).characters.map((c) => c.id)).toEqual(['c1', 'c2'])

    const live = new Set(['scene-node', 'c1-node', 'manual'])
    const withNodes = {
      ...doc,
      characters: [
        { ...doc.characters[0]!, nodeId: 'c1-node', baseHash: 'c1-hash' },
        { ...doc.characters[1]!, nodeId: 'c2-node', baseHash: 'c2-hash' },
      ],
      scenes: [{ ...doc.scenes[0]!, nodeId: 'scene-node', baseHash: 'scene-hash' }],
    }
    expect(shotRefNodeIds(withNodes, shot, live)).toEqual(['scene-node', 'c1-node'])
    expect(planShotRefEdges(withNodes, shot, ['c1-node', 'manual'], live)).toEqual({
      connect: ['scene-node'],
      disconnect: [],
    })
    expect(assetBasePrompt(doc.scenes[0]!, 'scene')).toContain('无人物空镜')
    expect(storyboardStats(doc)).toEqual({ episodes: 0, shots: 1, durationSec: 4 })
  })
})

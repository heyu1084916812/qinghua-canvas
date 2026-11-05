import { describe, expect, it } from 'vitest'
import * as publicApi from './storyboard'
import * as model from './model'
import * as normalization from './normalization'
import * as ordering from './shotOrdering'
import * as editing from './editing'
import * as assetEditing from './assetEditing'
import * as presentation from './presentation'
import * as markdownExport from './markdownExport'
import * as mirrors from './mergesAndMirrors'

const CONSTANT_EXPORTS = [
  'DEFAULT_BGM_VOLUME',
  'DEFAULT_TRANSITION_SECONDS',
  'MIN_TRANSITION_SECONDS',
  'MAX_TRANSITION_SECONDS',
  'DEFAULT_SHOT_SECONDS',
  'ASSET_BLOCK_HEADER',
] as const

const FUNCTION_EXPORTS = [
  'clampTransitionSeconds',
  'emptyStoryboard',
  'parseStoryboard',
  'pairKey',
  'dismissMerge',
  'normalizeShotOrder',
  'shotPrompt',
  'assetsOfShot',
  'shotRefNodeIds',
  'planShotRefEdges',
  'shotPromptWithAssets',
  'shotVideoPrompt',
  'updateScript',
  'updateSourceText',
  'addEpisode',
  'updateEpisode',
  'removeEpisode',
  'moveEpisode',
  'addShot',
  'updateShot',
  'shotDialogueLines',
  'shotDialogueTextOf',
  'addShotLine',
  'updateShotLine',
  'speechSettingsOf',
  'removeShotLine',
  'removeShot',
  'moveShot',
  'shotsOf',
  'addCharacter',
  'addScene',
  'updateCharacter',
  'updateScene',
  'removeCharacter',
  'removeScene',
  'mergeAsset',
  'bindShotScene',
  'toggleShotCharacter',
  'sceneNameOf',
  'characterNamesOf',
  'assetBasePrompt',
  'assetTurnaroundPrompt',
  'setAssetNode',
  'setAssetBaseHash',
  'setAssetTurnaroundNode',
  'setAssetTurnaroundHash',
  'shotsNeedingNode',
  'attachShotNodes',
  'attachShotImages',
  'setShotVideoNode',
  'attachShotVideos',
  'mergeStoryboardRunResults',
  'storyboardStats',
  'exportStoryboardMarkdown',
] as const

function doc() {
  return publicApi.parseStoryboard(
    {
      script: { title: '雨夜', logline: '一句话', body: '剧本正文' },
      sourceText: '原文',
      sourceRange: { from: 1, to: 2 },
      characters: [
        {
          id: 'c1',
          name: '骑手',
          description: '蓝色雨衣',
          aliases: ['骑手', '小哥'],
          voice: 'voice-1',
          speed: 2,
        },
      ],
      scenes: [{ id: 's1', name: '街道', description: '积水', aliases: [] }],
      episodes: [
        {
          id: 'e2',
          title: '第二集',
          summary: '第二段 | 换行',
          sourceRange: { from: 2, to: 5 },
          hookOpen: '开场钩子',
          hookEnd: '结尾钩子',
          bgmHash: 'bgm-hash',
          bgmName: '雨声',
          bgmVolume: 0.7,
        },
        { id: 'e1', title: '第一集', summary: '第一段' },
      ],
      shots: [
        {
          id: 'sh-e2',
          episodeId: 'e2',
          scene: '雨夜 | 街道\n转身',
          dialogue: '早啊',
          durationSec: 4,
          prompt: '雨夜暖光',
          sceneId: 's1',
          characterIds: ['c1', 'missing'],
          transition: 'fade',
          transitionSec: 0.5,
        },
        {
          id: 'sh-e1',
          episodeId: 'e1',
          scene: '清晨',
          lines: [{ id: 'line-1', text: '出发', speakerId: 'c1' }],
          durationSec: 3,
          prompt: '',
        },
        { id: 'sh-orphan', episodeId: 'missing', scene: '孤儿' },
      ],
      updatedAt: 7,
    },
    'project-1',
  )
}

describe('storyboard · 拆分前行为基线', () => {
  it('公共导出集合与值/函数形状不变', () => {
    expect(Object.keys(publicApi).sort()).toEqual(
      [...CONSTANT_EXPORTS, ...FUNCTION_EXPORTS].sort(),
    )
    for (const key of FUNCTION_EXPORTS) expect(publicApi[key]).toBeTypeOf('function')
    expect(publicApi.DEFAULT_BGM_VOLUME).toBe(0.2)
    expect(publicApi.DEFAULT_SHOT_SECONDS).toBe(3)
    expect(publicApi.ASSET_BLOCK_HEADER).toContain('不要画进画面')
    const withSceneAndCharacter = {
      ...publicApi.emptyStoryboard('p1'),
      characters: [publicApi.addCharacter(publicApi.emptyStoryboard('p1')).characters[0]!],
      scenes: [publicApi.addScene(publicApi.emptyStoryboard('p1')).scenes[0]!],
    }
    const [character] = withSceneAndCharacter.characters
    const [scene] = withSceneAndCharacter.scenes
    expect(publicApi.dismissMerge(withSceneAndCharacter, 'char', character!.id, scene!.id)).toBe(
      withSceneAndCharacter,
    )
  })

  it('搬出的公共实现仍由原入口 re-export 同一函数引用', () => {
    expect(publicApi.emptyStoryboard).toBe(model.emptyStoryboard)
    expect(publicApi.parseStoryboard).toBe(normalization.parseStoryboard)
    expect(publicApi.normalizeShotOrder).toBe(ordering.normalizeShotOrder)
    expect(publicApi.addEpisode).toBe(editing.addEpisode)
    expect(publicApi.addCharacter).toBe(assetEditing.addCharacter)
    expect(publicApi.exportStoryboardMarkdown).toBe(markdownExport.exportStoryboardMarkdown)
    expect(publicApi.shotPromptWithAssets).toBe(presentation.shotPromptWithAssets)
    expect(publicApi.mergeStoryboardRunResults).toBe(mirrors.mergeStoryboardRunResults)
  })

  it('坏数据容错读回：只补坏项、丢孤儿镜头和悬空引用、迁移旧对白', () => {
    const parsed = doc()
    expect(parsed.projectId).toBe('project-1')
    expect(parsed.script).toEqual({ title: '雨夜', logline: '一句话', body: '剧本正文' })
    expect(parsed.updatedAt).toBe(7)
    expect(parsed.episodes.map((episode) => episode.id)).toEqual(['e2', 'e1'])
    expect(parsed.shots.map((shot) => shot.id)).toEqual(['sh-e2', 'sh-e1'])
    expect(parsed.shots[0]).toMatchObject({
      id: 'sh-e2',
      sceneId: 's1',
      characterIds: ['c1'],
      transition: 'fade',
      transitionSec: 0.5,
    })
    expect(parsed.shots[0]?.lines).toEqual([{ id: 'legacy-1', text: '早啊' }])
    expect(parsed.characters[0]?.aliases).toEqual(['小哥'])
  })

  it('镜头整序：集顺序优先、集内保持原有先后，增删移遵守稳定顺序', () => {
    const parsed = doc()
    let edited = publicApi.addShot(parsed, 'e1', 8)
    expect(edited.shots.map((shot) => shot.id)).toEqual([
      'sh-e2',
      'sh-e1',
      expect.stringMatching(/^shot/),
    ])
    edited = publicApi.removeEpisode(edited, 'e1', 9)
    expect(edited.episodes.map((episode) => episode.id)).toEqual(['e2'])
    expect(edited.shots.map((shot) => shot.id)).toEqual(['sh-e2'])
    expect(publicApi.moveShot(edited, 'sh-e2', 1, 10)).toBe(edited)
    expect(publicApi.normalizeShotOrder(parsed)).toEqual(parsed.shots)
  })

  it('Markdown 导出：溯源、资产设定、对话和单元格转义共用同一份文档读法', () => {
    const markdown = publicApi.exportStoryboardMarkdown(doc())
    expect(markdown).toContain('# 雨夜')
    expect(markdown).toContain('共 2 集 / 2 镜 / 粗排 7 秒')
    expect(markdown).toContain('## 第 1 集 · 第二集')
    expect(markdown).toContain('> 原文第 3–5 字')
    expect(markdown).toContain('> 背景音乐：雨声（bgm-hash…，音量 70%）')
    expect(markdown).toContain('| 1 | 雨夜 \\| 街道 转身 | 街道 | 骑手 | 早啊 | 4s |')
    expect(markdown).toContain(publicApi.ASSET_BLOCK_HEADER.replace(/\n/g, ' '))
    expect(markdown).toContain('## 第 2 集 · 第一集')
    expect(markdown.trimEnd().endsWith('|')).toBe(true)
    expect(markdown.endsWith('\n')).toBe(true)
  })

  it('读回两次幂等；编辑不变化时返回原引用', () => {
    const raw = doc()
    const parsed = publicApi.parseStoryboard(raw, 'project-2')
    expect(publicApi.parseStoryboard(parsed, 'project-2')).toEqual({
      ...parsed,
      projectId: 'project-2',
    })
    expect(publicApi.updateSourceText(parsed, parsed.sourceText, 99)).toBe(parsed)
    expect(publicApi.removeShot(parsed, 'missing', 99)).not.toBe(parsed)
  })
})

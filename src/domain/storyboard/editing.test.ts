import { describe, expect, it } from 'vitest'
import { emptyStoryboard } from './model'
import {
  addEpisode,
  addShot,
  addShotLine,
  moveEpisode,
  moveShot,
  removeEpisode,
  removeShot,
  removeShotLine,
  speechSettingsOf,
  updateEpisode,
  updateScript,
  updateShot,
  updateShotLine,
  updateSourceText,
} from './editing'

function sample() {
  let doc = addEpisode(emptyStoryboard('p1'), 1)
  doc = addEpisode(doc, 2)
  const [e1, e2] = doc.episodes
  doc = addShot(doc, e1!.id, 3)
  doc = addShot(doc, e1!.id, 4)
  doc = addShot(doc, e2!.id, 5)
  return doc
}

describe('storyboard · 分集与分镜增删移', () => {
  it('新增镜头按集归位，删集连镜头一起删，移动只在边界内生效', () => {
    const doc = sample()
    const [e1, e2] = doc.episodes
    const added = addShot(doc, e2!.id, 6)
    expect(added.shots.map((shot) => shot.episodeId)).toEqual([e1!.id, e1!.id, e2!.id, e2!.id])
    expect(addShot(doc, 'missing', 7)).toBe(doc)
    expect(moveEpisode(doc, e1!.id, -1, 7)).toBe(doc)
    const movedEpisode = moveEpisode(doc, e2!.id, -1, 7)
    expect(movedEpisode.episodes.map((episode) => episode.id)).toEqual([e2!.id, e1!.id])
    expect(removeEpisode(doc, e1!.id, 8).shots).toHaveLength(1)
    const [first] = doc.shots
    expect(moveShot(doc, first!.id, -1, 9)).toBe(doc)
    expect(moveShot(doc, first!.id, 1, 9).shots[0]?.id).toBe(doc.shots[1]?.id)
    expect(removeShot(doc, first!.id, 10).shots).toHaveLength(2)
  })

  it('脚本与镜头补丁、BGM 清空、时长夹取都保持原有空操作语义', () => {
    const doc = sample()
    expect(updateScript(doc, { title: '标题' }, 11).script.body).toBe('')
    expect(updateSourceText(doc, '', 12)).toBe(doc)
    const [shot] = doc.shots
    expect(updateShot(doc, shot!.id, { durationSec: 0 }).shots[0]?.durationSec).toBe(1)
    expect(updateShot(doc, shot!.id, { transition: 'cut' }).shots[0]?.transition).toBeUndefined()
    const [episode] = doc.episodes
    const withBgm = updateEpisode(doc, episode!.id, {
      bgmHash: 'hash',
      bgmName: '曲名',
      bgmVolume: 2,
    }, 13)
    expect(withBgm.episodes[0]?.bgmVolume).toBe(1)
    const cleared = updateEpisode(withBgm, episode!.id, { bgmHash: '' }, 14)
    expect('bgmHash' in cleared.episodes[0]!).toBe(false)
    expect('bgmVolume' in cleared.episodes[0]!).toBe(false)
  })

  it('对白增删改与音色继承：无变化返回原引用，显式 speed=1 不丢', () => {
    let doc = sample()
    const [shot] = doc.shots
    doc = addShotLine(doc, shot!.id, { text: '早啊' }, 15)
    const [line] = doc.shots[0]!.lines
    expect(updateShotLine(doc, shot!.id, line!.id, { text: '早啊' }, 16)).toBe(doc)
    doc = updateShotLine(doc, shot!.id, line!.id, { speed: 1, text: '早上好' }, 17)
    expect(doc.shots[0]?.lines[0]).toMatchObject({ speed: 1, text: '早上好' })
    expect(speechSettingsOf(doc, doc.shots[0]!.lines[0]!)).toEqual({ speed: 1 })
    expect(removeShotLine(doc, shot!.id, line!.id, 18).shots[0]?.lines).toEqual([])
    expect(removeShotLine(doc, shot!.id, 'missing', 19)).toBe(doc)
  })
})

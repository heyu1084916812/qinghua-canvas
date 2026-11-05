import {
  type DramaAsset,
  type DramaCharacter,
  type DramaScene,
  type StoryboardDoc,
  type StoryboardShot,
} from './model'

export const ASSET_BLOCK_HEADER =
  '保持以下角色与场景的设定在整部片里一致；这些文字只是设定说明，不要画进画面：'

export function shotPrompt(shot: StoryboardShot): string {
  return shot.prompt.trim() || shot.scene.trim()
}

export function assetsOfShot(
  doc: StoryboardDoc,
  shot: StoryboardShot,
): { scene?: DramaScene; characters: DramaCharacter[] } {
  const scene = shot.sceneId ? doc.scenes.find((s) => s.id === shot.sceneId) : undefined
  const ids = new Set(shot.characterIds ?? [])
  return {
    ...(scene ? { scene } : {}),
    characters: ids.size > 0 ? doc.characters.filter((c) => ids.has(c.id)) : [],
  }
}

export function shotRefNodeIds(
  doc: StoryboardDoc,
  shot: StoryboardShot,
  liveNodeIds: ReadonlySet<string>,
): string[] {
  const { scene, characters } = assetsOfShot(doc, shot)
  const out: string[] = []
  const push = (asset: DramaAsset) => {
    if (!asset.baseHash || !asset.nodeId) return
    if (!liveNodeIds.has(asset.nodeId)) return
    if (out.includes(asset.nodeId)) return
    out.push(asset.nodeId)
  }
  if (scene) push(scene)
  for (const c of characters) push(c)
  return out
}

export function planShotRefEdges(
  doc: StoryboardDoc,
  shot: StoryboardShot,
  incomingSources: readonly string[],
  liveNodeIds: ReadonlySet<string>,
): { connect: string[]; disconnect: string[] } {
  const wanted = new Set(shotRefNodeIds(doc, shot, liveNodeIds))
  const managed = new Set<string>()
  for (const asset of [...doc.characters, ...doc.scenes]) {
    if (asset.nodeId && liveNodeIds.has(asset.nodeId)) managed.add(asset.nodeId)
  }
  const incoming = new Set(incomingSources)
  return {
    connect: [...wanted].filter((id) => !incoming.has(id)),
    disconnect: [...incoming].filter((id) => managed.has(id) && !wanted.has(id)),
  }
}

export function shotPromptWithAssets(doc: StoryboardDoc, shot: StoryboardShot): string {
  const base = shotPrompt(shot)
  const { scene, characters } = assetsOfShot(doc, shot)
  const lines: string[] = []
  if (scene) {
    lines.push(`场景「${scene.name}」${scene.description.trim() ? `：${scene.description.trim()}` : ''}`)
  }
  for (const c of characters) {
    lines.push(`角色「${c.name}」${c.description.trim() ? `：${c.description.trim()}` : ''}`)
  }
  if (lines.length === 0) return base
  return `${base}\n\n${ASSET_BLOCK_HEADER}\n${lines.join('\n')}`
}

export function shotVideoPrompt(
  doc: StoryboardDoc,
  shot: StoryboardShot,
  nextShot?: StoryboardShot,
): string {
  const visual = shotPromptWithAssets(doc, shot)
  const motion = shot.videoPrompt?.trim()
  const lines = [motion ? `${motion}\n\n画面基准：${visual}` : visual]
  if (!motion) {
    lines.push('镜头运动：生成自然、连续的镜头运动，保持人物身份、服装、场景与光线一致。')
  }
  if (nextShot) {
    const nextScene = nextShot.scene.trim() || shotPrompt(nextShot)
    lines.push(
      `镜头衔接：从这一镜自然过渡到下一镜——${nextScene}。` +
        '动作、视线与运动方向要连续，避免突然跳变。',
    )
  }
  return lines.join('\n\n')
}

export function sceneNameOf(doc: StoryboardDoc, shot: StoryboardShot): string {
  if (!shot.sceneId) return ''
  return doc.scenes.find((s) => s.id === shot.sceneId)?.name ?? ''
}

export function characterNamesOf(doc: StoryboardDoc, shot: StoryboardShot): string[] {
  if (!shot.characterIds || shot.characterIds.length === 0) return []
  const ids = new Set(shot.characterIds)
  return doc.characters.filter((c) => ids.has(c.id)).map((c) => c.name)
}

export function assetBasePrompt(asset: DramaAsset, kind: 'char' | 'scene'): string {
  const name = asset.name.trim() || (kind === 'char' ? '角色' : '场景')
  const desc = asset.description.trim()
  const head = kind === 'char' ? '角色定妆图' : '场景基准图'
  const tail =
    kind === 'char'
      ? '正面半身，中性表情，干净的纯色背景，清晰展示发型、服装与配饰细节，画面里不要出现任何文字'
      : '无人物空镜，展示场地结构与氛围，光线自然，画面里不要出现任何文字'
  return `${head}：${name}${desc ? `。${desc}` : ''}。${tail}`
}

export function assetTurnaroundPrompt(asset: DramaAsset): string {
  const name = asset.name.trim() || '角色'
  const desc = asset.description.trim()
  return (
    `角色多视角设定图：${name}${desc ? `。${desc}` : ''}。` +
    '同一角色、同一光照、同一服装与配饰，正面全身、侧面全身、背面全身、正面脸部特写四格并排，' +
    '纯色背景，各视角比例与五官一致，画面里不要出现任何文字'
  )
}

export interface StoryboardStats {
  episodes: number
  shots: number
  durationSec: number
}

export function storyboardStats(doc: StoryboardDoc): StoryboardStats {
  return {
    episodes: doc.episodes.length,
    shots: doc.shots.length,
    durationSec: doc.shots.reduce((sum, s) => sum + Math.max(0, s.durationSec), 0),
  }
}

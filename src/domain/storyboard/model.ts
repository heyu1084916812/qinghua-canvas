export interface StoryboardScript {
  title: string
  /** 一句话故事（列表里显示这一条，不进提示词） */
  logline: string
  /** 剧本正文（自由文本；分镜从这里拆） */
  body: string
}

/**
 * **资产**（角色 / 场景，对账 #416；调研稿 §6.1 / §6.3）。
 *
 * 形态刻意与调研一致：`name` + `aliases[]` + `description`。
 *
 * - **放项目级、不放集级**：同一角色在第 1 集和第 30 集必须是同一个对象
 *   （Autodesk Flow 那条共识，调研稿 §6.1 的取舍表）。
 * - `aliases` 是**归并的抓手**：「林轩 / 林公子」是同一个人的两种叫法，
 *   抽取结果按它去重（调研稿 §6.3 第 2 条）。
 * - `description` 是**一致性的物理来源**：以后接参考图 / 定妆图时，
 *   这一段会拼进提示词（本批还不生成，别把它当成"已经用上了"）。
 */
export interface DramaAsset {
  id: string
  name: string
  description: string
  aliases: string[]
  /** 生成节点 id 是缓存不是真相；画布节点被删掉后就当作还没做基准图。 */
  nodeId?: string
  /** 角色定妆图 / 场景基准图的素材 hash。 */
  baseHash?: string
  turnaroundNodeId?: string
  turnaroundHash?: string
}

export interface DramaCharacter extends DramaAsset {
  voice?: string
  speed?: number
}
export type DramaScene = DramaAsset

/** 一镜里的一句台词（对账 #435）。 */
export interface StoryboardLine {
  id: string
  speakerId?: string
  text: string
  emotion?: string
  voice?: string
  speed?: number
  audioHash?: string
  audioName?: string
}

export interface StoryboardEpisode {
  id: string
  title: string
  summary: string
  sourceRange?: { from: number; to: number }
  hookOpen?: string
  hookEnd?: string
  bgmHash?: string
  bgmName?: string
  bgmVolume?: number
}

export const DEFAULT_BGM_VOLUME = 0.2
export const DEFAULT_TRANSITION_SECONDS = 0.3
export const MIN_TRANSITION_SECONDS = 0.1
export const MAX_TRANSITION_SECONDS = 1

export function clampTransitionSeconds(value: unknown): number {
  const number = typeof value === 'number' && Number.isFinite(value)
    ? value
    : DEFAULT_TRANSITION_SECONDS
  return Math.min(MAX_TRANSITION_SECONDS, Math.max(MIN_TRANSITION_SECONDS, number))
}

export interface StoryboardShot {
  id: string
  episodeId: string
  scene: string
  lines: StoryboardLine[]
  durationSec: number
  transition?: 'cut' | 'fade'
  transitionSec?: number
  prompt: string
  videoPrompt?: string
  sceneId?: string
  characterIds?: string[]
  nodeId?: string
  imageHash?: string
  videoNodeId?: string
  videoEndNodeId?: string
  videoHash?: string
}

export interface StoryboardDoc {
  projectId: string
  sourceText: string
  script: StoryboardScript
  characters: DramaCharacter[]
  scenes: DramaScene[]
  episodes: StoryboardEpisode[]
  shots: StoryboardShot[]
  mergeDismissals?: string[]
  updatedAt: number
}

export const DEFAULT_SHOT_SECONDS = 3

export function emptyStoryboard(projectId: string, now = 0): StoryboardDoc {
  return {
    projectId,
    sourceText: '',
    script: { title: '未命名漫剧', logline: '', body: '' },
    characters: [],
    scenes: [],
    episodes: [],
    shots: [],
    updatedAt: now,
  }
}

export const text = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
export const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

export function clampVolume(value: unknown, fallback = DEFAULT_BGM_VOLUME): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

export function clampSpeechSpeed(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.min(4, Math.max(0.25, n)) * 100) / 100
}

export type AssetKind = 'char' | 'scene'

import {
  clampSpeechSpeed,
  clampTransitionSeconds,
  clampVolume,
  DEFAULT_SHOT_SECONDS,
  num,
  text,
  type DramaAsset,
  type DramaCharacter,
  type StoryboardDoc,
  type StoryboardEpisode,
  type StoryboardLine,
  type StoryboardShot,
} from './model'
import { normalizeShotOrder } from './shotOrdering'

/** 一镜的对白层读回（含老 `dialogue` 数据迁移，id 保持幂等）。 */
function parseShotLines(
  row: Record<string, unknown>,
  knownCharacters: ReadonlySet<string>,
): StoryboardLine[] {
  const raw = Array.isArray(row.lines) ? row.lines : []
  const lines: StoryboardLine[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = text(record.id)
    const body = text(record.text).trim()
    if (!id || !body) continue
    const speakerRaw = text(record.speakerId)
    const speakerId = speakerRaw && knownCharacters.has(speakerRaw) ? speakerRaw : ''
    const emotion = text(record.emotion).trim()
    const voice = text(record.voice).trim()
    const hasSpeed =
      record.speed !== undefined &&
      record.speed !== null &&
      record.speed !== '' &&
      Number.isFinite(Number(record.speed))
    const speed = clampSpeechSpeed(record.speed, 1)
    const audioHash = text(record.audioHash).trim()
    const audioName = text(record.audioName).trim()
    lines.push({
      id,
      text: body,
      ...(speakerId ? { speakerId } : {}),
      ...(emotion ? { emotion } : {}),
      ...(voice ? { voice } : {}),
      ...(hasSpeed ? { speed } : {}),
      ...(audioHash
        ? {
            audioHash,
            ...(audioName ? { audioName } : {}),
          }
        : {}),
    })
  }
  if (lines.length > 0) return lines
  const legacy = text(row.dialogue).trim()
  return legacy ? [{ id: 'legacy-1', text: legacy }] : []
}

/** 资产数组容错读回：缺 id / name 整条丢掉，别名只留非空字符串且去重。 */
function parseAssetList(raw: unknown, withSpeech = false): DramaAsset[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((a) => {
    if (!a || typeof a !== 'object') return []
    const row = a as Record<string, unknown>
    const id = text(row.id)
    const name = text(row.name)
    if (!id || !name) return []
    const aliases = Array.isArray(row.aliases)
      ? [...new Set(row.aliases.map((v) => text(v)).filter((v) => v && v !== name))]
      : []
    const nodeId = text(row.nodeId)
    const baseHash = text(row.baseHash)
    const turnaroundNodeId = text(row.turnaroundNodeId)
    const turnaroundHash = text(row.turnaroundHash)
    const voice = withSpeech ? text(row.voice).trim() : ''
    const hasSpeed =
      withSpeech &&
      row.speed !== undefined &&
      row.speed !== null &&
      row.speed !== '' &&
      Number.isFinite(Number(row.speed))
    const speed = hasSpeed ? clampSpeechSpeed(row.speed, 1) : 1
    return [
      {
        id,
        name,
        description: text(row.description),
        aliases,
        ...(nodeId ? { nodeId } : {}),
        ...(baseHash ? { baseHash } : {}),
        ...(turnaroundNodeId ? { turnaroundNodeId } : {}),
        ...(turnaroundHash ? { turnaroundHash } : {}),
        ...(voice ? { voice } : {}),
        ...(hasSpeed ? { speed } : {}),
      },
    ]
  })
}

/** 脏数据只补坏项：悬空引用与孤儿镜头一律不进入界面/导出。 */
export function parseStoryboard(raw: unknown, projectId: string): StoryboardDoc {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const scriptRaw = o.script && typeof o.script === 'object' ? (o.script as Record<string, unknown>) : {}
  const characters: DramaCharacter[] = parseAssetList(o.characters, true)
  const scenes = parseAssetList(o.scenes)
  const knownCharacters = new Set(characters.map((c) => c.id))
  const knownScenes = new Set(scenes.map((s) => s.id))
  const episodes: StoryboardEpisode[] = (Array.isArray(o.episodes) ? o.episodes : []).flatMap((e) => {
    if (!e || typeof e !== 'object') return []
    const row = e as Record<string, unknown>
    const id = text(row.id)
    if (!id) return []
    const hookOpen = text(row.hookOpen)
    const hookEnd = text(row.hookEnd)
    const bgmHash = text(row.bgmHash)
    const bgmName = text(row.bgmName)
    const bgmVolume = clampVolume(row.bgmVolume)
    const rangeRaw = row.sourceRange && typeof row.sourceRange === 'object' ? (row.sourceRange as Record<string, unknown>) : null
    const from = rangeRaw ? num(rangeRaw.from, -1) : -1
    const to = rangeRaw ? num(rangeRaw.to, -1) : -1
    return [
      {
        id,
        title: text(row.title) || '未命名一集',
        summary: text(row.summary),
        ...(from >= 0 && to > from ? { sourceRange: { from, to } } : {}),
        ...(hookOpen ? { hookOpen } : {}),
        ...(hookEnd ? { hookEnd } : {}),
        ...(bgmHash
          ? {
              bgmHash,
              ...(bgmName ? { bgmName } : {}),
              bgmVolume,
            }
          : {}),
      },
    ]
  })
  const known = new Set(episodes.map((e) => e.id))
  const shots: StoryboardShot[] = (Array.isArray(o.shots) ? o.shots : []).flatMap((s) => {
    if (!s || typeof s !== 'object') return []
    const row = s as Record<string, unknown>
    const id = text(row.id)
    const episodeId = text(row.episodeId)
    if (!id || !known.has(episodeId)) return []
    const nodeId = text(row.nodeId)
    const imageHash = text(row.imageHash)
    const videoNodeId = text(row.videoNodeId)
    const videoEndNodeId = text(row.videoEndNodeId)
    const videoHash = text(row.videoHash)
    const transition = text(row.transition).trim() === 'fade' ? 'fade' : ''
    const transitionSec =
      transition === 'fade' &&
      typeof row.transitionSec === 'number' &&
      Number.isFinite(row.transitionSec)
        ? clampTransitionSeconds(row.transitionSec)
        : undefined
    const sceneIdRaw = text(row.sceneId)
    const sceneId = sceneIdRaw && knownScenes.has(sceneIdRaw) ? sceneIdRaw : ''
    const characterRefs = Array.isArray(row.characterIds)
      ? [
          ...new Set(
            row.characterIds.map((v) => text(v)).filter((v) => v && knownCharacters.has(v)),
          ),
        ]
      : []
    return [
      {
        id,
        episodeId,
        scene: text(row.scene),
        lines: parseShotLines(row, knownCharacters),
        durationSec: num(row.durationSec, DEFAULT_SHOT_SECONDS),
        prompt: text(row.prompt),
        ...(text(row.videoPrompt).trim() ? { videoPrompt: text(row.videoPrompt).trim() } : {}),
        ...(transition ? { transition } : {}),
        ...(transitionSec !== undefined ? { transitionSec } : {}),
        ...(nodeId ? { nodeId } : {}),
        ...(imageHash ? { imageHash } : {}),
        ...(videoNodeId ? { videoNodeId } : {}),
        ...(videoEndNodeId ? { videoEndNodeId } : {}),
        ...(videoHash ? { videoHash } : {}),
        ...(sceneId ? { sceneId } : {}),
        ...(characterRefs.length > 0 ? { characterIds: characterRefs } : {}),
      },
    ]
  })
  const doc: StoryboardDoc = {
    projectId,
    sourceText: text(o.sourceText),
    script: {
      title: text(scriptRaw.title) || '未命名漫剧',
      logline: text(scriptRaw.logline),
      body: text(scriptRaw.body),
    },
    characters,
    scenes,
    episodes,
    shots,
    ...(() => {
      const alive = new Set([...characters, ...scenes].map((a) => a.id))
      const pairs = Array.isArray(o.mergeDismissals)
        ? [
            ...new Set(
              o.mergeDismissals
                .map((v) => text(v))
                .filter((v) => {
                  const [a, b] = v.split('|')
                  return !!a && !!b && alive.has(a) && alive.has(b)
                }),
            ),
          ]
        : []
      return pairs.length > 0 ? { mergeDismissals: pairs } : {}
    })(),
    updatedAt: num(o.updatedAt, 0),
  }
  return { ...doc, shots: normalizeShotOrder(doc) }
}

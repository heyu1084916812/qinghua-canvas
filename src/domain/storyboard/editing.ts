import { createId } from '../../shared/id'
import {
  clampSpeechSpeed,
  clampTransitionSeconds,
  clampVolume,
  DEFAULT_BGM_VOLUME,
  DEFAULT_SHOT_SECONDS,
  num,
  text,
  type StoryboardDoc,
  type StoryboardEpisode,
  type StoryboardLine,
  type StoryboardScript,
  type StoryboardShot,
} from './model'
import { normalizeShotOrder } from './shotOrdering'

export function updateScript(
  doc: StoryboardDoc,
  patch: Partial<StoryboardScript>,
  now = 0,
): StoryboardDoc {
  return {
    ...doc,
    script: {
      title: text(patch.title, doc.script.title),
      logline: text(patch.logline, doc.script.logline),
      body: text(patch.body, doc.script.body),
    },
    updatedAt: now,
  }
}

export function updateSourceText(doc: StoryboardDoc, text: string, now = 0): StoryboardDoc {
  if (text === doc.sourceText) return doc
  return { ...doc, sourceText: text, updatedAt: now }
}

export function addEpisode(doc: StoryboardDoc, now = 0): StoryboardDoc {
  const episode: StoryboardEpisode = {
    id: createId('ep'),
    title: `第 ${doc.episodes.length + 1} 集`,
    summary: '',
  }
  return { ...doc, episodes: [...doc.episodes, episode], updatedAt: now }
}

export function updateEpisode(
  doc: StoryboardDoc,
  id: string,
  patch: Partial<
    Pick<
      StoryboardEpisode,
      'title' | 'summary' | 'hookOpen' | 'hookEnd' | 'bgmHash' | 'bgmName' | 'bgmVolume'
    >
  >,
  now = 0,
): StoryboardDoc {
  return {
    ...doc,
    episodes: doc.episodes.map((e) => {
      if (e.id !== id) return e
      const hookOpen = text(patch.hookOpen, e.hookOpen ?? '').trim()
      const hookEnd = text(patch.hookEnd, e.hookEnd ?? '').trim()
      const bgmHash = text(patch.bgmHash, e.bgmHash ?? '').trim()
      const bgmName = text(patch.bgmName, e.bgmName ?? '').trim()
      const bgmVolume = clampVolume(patch.bgmVolume, e.bgmVolume ?? DEFAULT_BGM_VOLUME)
      const next: StoryboardEpisode = {
        ...e,
        title: text(patch.title, e.title) || e.title,
        summary: text(patch.summary, e.summary),
      }
      if (hookOpen) next.hookOpen = hookOpen
      else delete next.hookOpen
      if (hookEnd) next.hookEnd = hookEnd
      else delete next.hookEnd
      if (bgmHash) {
        next.bgmHash = bgmHash
        if (bgmName) next.bgmName = bgmName
        else delete next.bgmName
        next.bgmVolume = bgmVolume
      } else {
        delete next.bgmHash
        delete next.bgmName
        delete next.bgmVolume
      }
      return next
    }),
    updatedAt: now,
  }
}

export function removeEpisode(doc: StoryboardDoc, id: string, now = 0): StoryboardDoc {
  return {
    ...doc,
    episodes: doc.episodes.filter((e) => e.id !== id),
    shots: doc.shots.filter((s) => s.episodeId !== id),
    updatedAt: now,
  }
}

export function moveEpisode(doc: StoryboardDoc, id: string, delta: number, now = 0): StoryboardDoc {
  const at = doc.episodes.findIndex((e) => e.id === id)
  const to = at + Math.sign(delta)
  if (at < 0 || to < 0 || to >= doc.episodes.length) return doc
  const next = doc.episodes.slice()
  const [item] = next.splice(at, 1)
  next.splice(to, 0, item!)
  return { ...doc, episodes: next, updatedAt: now }
}

export function addShot(doc: StoryboardDoc, episodeId: string, now = 0): StoryboardDoc {
  if (!doc.episodes.some((e) => e.id === episodeId)) return doc
  const shot: StoryboardShot = {
    id: createId('shot'),
    episodeId,
    scene: '',
    lines: [],
    durationSec: DEFAULT_SHOT_SECONDS,
    prompt: '',
  }
  return { ...doc, shots: normalizeShotOrder({ ...doc, shots: [...doc.shots, shot] }), updatedAt: now }
}

export function updateShot(
  doc: StoryboardDoc,
  id: string,
  patch: Partial<Omit<StoryboardShot, 'id' | 'episodeId' | 'lines'>>,
  now = 0,
): StoryboardDoc {
  return {
    ...doc,
    shots: doc.shots.map((s) => {
      if (s.id !== id) return s
      const next: StoryboardShot = {
        ...s,
        scene: text(patch.scene, s.scene),
        durationSec: Math.max(1, Math.round(num(patch.durationSec, s.durationSec))),
        prompt: text(patch.prompt, s.prompt),
        videoPrompt: text(patch.videoPrompt, s.videoPrompt ?? ''),
      }
      if (patch.transition === 'fade') next.transition = 'fade'
      else if (patch.transition === 'cut') {
        delete next.transition
        delete next.transitionSec
      }
      if (patch.transitionSec !== undefined && next.transition === 'fade') {
        next.transitionSec = clampTransitionSeconds(patch.transitionSec)
      }
      return next
    }),
    updatedAt: now,
  }
}

function speakerNameOf(doc: StoryboardDoc, line: StoryboardLine): string {
  if (!line.speakerId) return ''
  return doc.characters.find((c) => c.id === line.speakerId)?.name ?? ''
}

export function shotDialogueLines(
  doc: StoryboardDoc,
  shot: StoryboardShot,
): {
  lineId: string
  speaker: string
  text: string
  voice?: string
  speed?: number
  audioHash?: string
}[] {
  return shot.lines.map((line) => ({
    lineId: line.id,
    speaker: speakerNameOf(doc, line),
    text: line.text,
    ...(line.voice ? { voice: line.voice } : {}),
    ...(line.speed !== undefined ? { speed: line.speed } : {}),
    ...(line.audioHash ? { audioHash: line.audioHash } : {}),
  }))
}

export function shotDialogueTextOf(doc: StoryboardDoc, shot: StoryboardShot): string {
  return shotDialogueLines(doc, shot)
    .map((line) => (line.speaker ? `${line.speaker}：${line.text}` : line.text))
    .join(' / ')
}

export function addShotLine(
  doc: StoryboardDoc,
  shotId: string,
  preset: { speakerId?: string; text?: string } = {},
  now = 0,
): StoryboardDoc {
  const shot = doc.shots.find((s) => s.id === shotId)
  if (!shot) return doc
  const body = text(preset.text).trim()
  const speakerId = text(preset.speakerId)
  const line: StoryboardLine = {
    id: createId('line'),
    text: body,
    ...(speakerId && doc.characters.some((c) => c.id === speakerId) ? { speakerId } : {}),
  }
  return {
    ...doc,
    shots: doc.shots.map((s) => (s.id === shotId ? { ...s, lines: [...s.lines, line] } : s)),
    updatedAt: now,
  }
}

export function updateShotLine(
  doc: StoryboardDoc,
  shotId: string,
  lineId: string,
  patch: Partial<Omit<StoryboardLine, 'id'>>,
  now = 0,
): StoryboardDoc {
  let changed = false
  const shots = doc.shots.map((shot) => {
    if (shot.id !== shotId) return shot
    let shotChanged = false
    const lines = shot.lines.map((line) => {
      if (line.id !== lineId) return line
      const next: StoryboardLine = { ...line }
      if (patch.text !== undefined) {
        const body = text(patch.text).trim()
        if (body !== line.text) {
          next.text = body
          delete next.audioHash
          delete next.audioName
          shotChanged = true
        }
      }
      if (patch.speakerId !== undefined) {
        const raw = text(patch.speakerId)
        const speakerId = raw && doc.characters.some((c) => c.id === raw) ? raw : ''
        if ((line.speakerId ?? '') !== speakerId) {
          if (speakerId) next.speakerId = speakerId
          else delete next.speakerId
          shotChanged = true
        }
      }
      if (patch.emotion !== undefined) {
        const emotion = text(patch.emotion).trim()
        if ((line.emotion ?? '') !== emotion) {
          if (emotion) next.emotion = emotion
          else delete next.emotion
          shotChanged = true
        }
      }
      if (patch.voice !== undefined) {
        const voice = text(patch.voice).trim()
        if ((line.voice ?? '') !== voice) {
          if (voice) next.voice = voice
          else delete next.voice
          delete next.audioHash
          delete next.audioName
          shotChanged = true
        }
      }
      if (patch.speed !== undefined) {
        const speed = clampSpeechSpeed(patch.speed, line.speed ?? 1)
        if (line.speed !== speed) {
          next.speed = speed
          delete next.audioHash
          delete next.audioName
          shotChanged = true
        }
      }
      if (patch.audioHash !== undefined) {
        const audioHash = text(patch.audioHash).trim()
        if ((line.audioHash ?? '') !== audioHash) {
          if (audioHash) next.audioHash = audioHash
          else delete next.audioHash
          shotChanged = true
        }
      }
      if (patch.audioName !== undefined) {
        const audioName = text(patch.audioName).trim()
        if ((line.audioName ?? '') !== audioName) {
          if (audioName) next.audioName = audioName
          else delete next.audioName
          shotChanged = true
        }
      }
      return shotChanged ? next : line
    })
    if (!shotChanged) return shot
    changed = true
    return { ...shot, lines }
  })
  return changed ? { ...doc, shots, updatedAt: now } : doc
}

export function speechSettingsOf(
  doc: StoryboardDoc,
  line: StoryboardLine,
): { voice?: string; speed: number } {
  const character = line.speakerId
    ? doc.characters.find((item) => item.id === line.speakerId)
    : undefined
  const voice = line.voice?.trim() || character?.voice?.trim() || ''
  const speed = line.speed ?? character?.speed ?? 1
  return {
    ...(voice ? { voice } : {}),
    speed: clampSpeechSpeed(speed, 1),
  }
}

export function removeShotLine(
  doc: StoryboardDoc,
  shotId: string,
  lineId: string,
  now = 0,
): StoryboardDoc {
  const shot = doc.shots.find((s) => s.id === shotId)
  if (!shot || !shot.lines.some((l) => l.id === lineId)) return doc
  return {
    ...doc,
    shots: doc.shots.map((s) =>
      s.id === shotId ? { ...s, lines: s.lines.filter((l) => l.id !== lineId) } : s,
    ),
    updatedAt: now,
  }
}

export function removeShot(doc: StoryboardDoc, id: string, now = 0): StoryboardDoc {
  return { ...doc, shots: doc.shots.filter((s) => s.id !== id), updatedAt: now }
}

export function moveShot(doc: StoryboardDoc, id: string, delta: number, now = 0): StoryboardDoc {
  const shot = doc.shots.find((s) => s.id === id)
  if (!shot) return doc
  const sameEpisode = doc.shots.filter((s) => s.episodeId === shot.episodeId)
  const at = sameEpisode.findIndex((s) => s.id === id)
  const to = at + Math.sign(delta)
  if (at < 0 || to < 0 || to >= sameEpisode.length) return doc
  const nextId = sameEpisode[to]!.id
  const a = doc.shots.findIndex((s) => s.id === id)
  const b = doc.shots.findIndex((s) => s.id === nextId)
  const next = doc.shots.slice()
  const tmp = next[a]!
  next[a] = next[b]!
  next[b] = tmp
  return { ...doc, shots: next, updatedAt: now }
}

export {
  addCharacter,
  addScene,
  updateCharacter,
  updateScene,
  removeCharacter,
  removeScene,
  mergeAsset,
  bindShotScene,
  toggleShotCharacter,
} from './assetEditing'

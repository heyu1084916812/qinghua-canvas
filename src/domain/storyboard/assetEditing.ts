import { createId } from '../../shared/id'
import {
  clampSpeechSpeed,
  text,
  type AssetKind,
  type DramaAsset,
  type DramaCharacter,
  type DramaScene,
  type StoryboardDoc,
  type StoryboardShot,
} from './model'

export function addCharacter(doc: StoryboardDoc, now = 0): StoryboardDoc {
  const character: DramaCharacter = {
    id: createId('char'),
    name: `角色 ${doc.characters.length + 1}`,
    description: '',
    aliases: [],
  }
  return { ...doc, characters: [...doc.characters, character], updatedAt: now }
}

export function addScene(doc: StoryboardDoc, now = 0): StoryboardDoc {
  const scene: DramaScene = {
    id: createId('scene'),
    name: `场景 ${doc.scenes.length + 1}`,
    description: '',
    aliases: [],
  }
  return { ...doc, scenes: [...doc.scenes, scene], updatedAt: now }
}

export function updateCharacter(
  doc: StoryboardDoc,
  id: string,
  patch: Partial<
    Pick<DramaCharacter, 'name' | 'description' | 'aliases' | 'voice' | 'speed'>
  >,
  now = 0,
): StoryboardDoc {
  if (!doc.characters.some((c) => c.id === id)) return doc
  const characters = doc.characters.map((c) => {
    if (c.id !== id) return c
    const name = text(patch.name, c.name).trim() || c.name
    const aliases = patch.aliases
      ? [...new Set(patch.aliases.map((a) => text(a).trim()).filter((a) => a && a !== name))]
      : c.aliases
    const next: DramaCharacter = {
      ...c,
      name,
      description: text(patch.description, c.description),
      aliases,
    }
    if (patch.voice !== undefined) {
      const voice = text(patch.voice).trim()
      if (voice) next.voice = voice
      else delete next.voice
    }
    if (patch.speed !== undefined) {
      const speed = clampSpeechSpeed(patch.speed, c.speed ?? 1)
      if (speed !== 1) next.speed = speed
      else delete next.speed
    }
    return next
  })
  return { ...doc, characters, updatedAt: now }
}

export function updateScene(
  doc: StoryboardDoc,
  id: string,
  patch: Partial<Pick<DramaAsset, 'name' | 'description' | 'aliases'>>,
  now = 0,
): StoryboardDoc {
  if (!doc.scenes.some((s) => s.id === id)) return doc
  const scenes = doc.scenes.map((s) => {
    if (s.id !== id) return s
    const name = text(patch.name, s.name).trim() || s.name
    const aliases = patch.aliases
      ? [...new Set(patch.aliases.map((a) => text(a).trim()).filter((a) => a && a !== name))]
      : s.aliases
    return { ...s, name, description: text(patch.description, s.description), aliases }
  })
  return { ...doc, scenes, updatedAt: now }
}

function withoutCharacterRef(shot: StoryboardShot, id: string): StoryboardShot {
  const next = (shot.characterIds ?? []).filter((v) => v !== id)
  const copy: StoryboardShot = { ...shot }
  if (next.length > 0) copy.characterIds = next
  else delete copy.characterIds
  return copy
}

export function removeCharacter(doc: StoryboardDoc, id: string, now = 0): StoryboardDoc {
  if (!doc.characters.some((c) => c.id === id)) return doc
  return {
    ...doc,
    characters: doc.characters.filter((c) => c.id !== id),
    shots: doc.shots.map((s) => (s.characterIds?.includes(id) ? withoutCharacterRef(s, id) : s)),
    updatedAt: now,
  }
}

export function removeScene(doc: StoryboardDoc, id: string, now = 0): StoryboardDoc {
  if (!doc.scenes.some((s) => s.id === id)) return doc
  return {
    ...doc,
    scenes: doc.scenes.filter((s) => s.id !== id),
    shots: doc.shots.map((s) => {
      if (s.sceneId !== id) return s
      const copy: StoryboardShot = { ...s }
      delete copy.sceneId
      return copy
    }),
    updatedAt: now,
  }
}

export function mergeAsset(
  doc: StoryboardDoc,
  kind: AssetKind,
  keepId: string,
  dropId: string,
  now = 0,
): StoryboardDoc {
  if (!keepId || !dropId || keepId === dropId) return doc
  const list = kind === 'char' ? doc.characters : doc.scenes
  const keep = list.find((a) => a.id === keepId)
  const drop = list.find((a) => a.id === dropId)
  if (!keep || !drop) return doc
  const aliases = [
    ...new Set(
      [...keep.aliases, drop.name, ...drop.aliases]
        .map((v) => v.trim())
        .filter((v) => v && v !== keep.name),
    ),
  ]
  const carry =
    !keep.baseHash && drop.baseHash && drop.nodeId
      ? { nodeId: drop.nodeId, baseHash: drop.baseHash }
      : !keep.nodeId && drop.nodeId
        ? { nodeId: drop.nodeId }
        : {}
  const carryTurnaround =
    !keep.turnaroundHash && drop.turnaroundHash && drop.turnaroundNodeId
      ? { turnaroundNodeId: drop.turnaroundNodeId, turnaroundHash: drop.turnaroundHash }
      : !keep.turnaroundNodeId && drop.turnaroundNodeId
        ? { turnaroundNodeId: drop.turnaroundNodeId }
        : {}
  const merged: DramaAsset = {
    ...keep,
    aliases,
    description: keep.description.trim() ? keep.description : drop.description,
    ...carry,
    ...carryTurnaround,
  }
  const nextList = list.filter((a) => a.id !== dropId).map((a) => (a.id === keepId ? merged : a))
  const shots = doc.shots.map((shot) => {
    if (kind === 'scene') {
      if (shot.sceneId !== dropId) return shot
      return { ...shot, sceneId: keepId }
    }
    if (!shot.characterIds?.includes(dropId)) return shot
    const refs = [...new Set(shot.characterIds.map((id) => (id === dropId ? keepId : id)))]
    return { ...shot, characterIds: refs }
  })
  return {
    ...doc,
    ...(kind === 'char' ? { characters: nextList } : { scenes: nextList }),
    shots,
    updatedAt: now,
  }
}

export function bindShotScene(
  doc: StoryboardDoc,
  shotId: string,
  sceneId: string | null,
  now = 0,
): StoryboardDoc {
  if (sceneId !== null && !doc.scenes.some((s) => s.id === sceneId)) return doc
  const shot = doc.shots.find((s) => s.id === shotId)
  if (!shot) return doc
  if (sceneId === null ? !shot.sceneId : shot.sceneId === sceneId) return doc
  const shots = doc.shots.map((s) => {
    if (s.id !== shotId) return s
    const copy: StoryboardShot = { ...s }
    if (sceneId !== null) copy.sceneId = sceneId
    else delete copy.sceneId
    return copy
  })
  return { ...doc, shots, updatedAt: now }
}

export function toggleShotCharacter(
  doc: StoryboardDoc,
  shotId: string,
  characterId: string,
  now = 0,
): StoryboardDoc {
  if (!doc.characters.some((c) => c.id === characterId)) return doc
  const shot = doc.shots.find((s) => s.id === shotId)
  if (!shot) return doc
  const has = shot.characterIds?.includes(characterId) ?? false
  const shots = doc.shots.map((s) => {
    if (s.id !== shotId) return s
    if (has) return withoutCharacterRef(s, characterId)
    return { ...s, characterIds: [...(s.characterIds ?? []), characterId] }
  })
  return { ...doc, shots, updatedAt: now }
}

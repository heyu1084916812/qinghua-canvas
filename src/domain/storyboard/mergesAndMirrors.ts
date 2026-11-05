import { pairKey, type AssetKind } from './rules'
import {
  type DramaAsset,
  type DramaCharacter,
  type StoryboardDoc,
  type StoryboardLine,
  type StoryboardShot,
} from './model'

export function dismissMerge(
  doc: StoryboardDoc,
  kind: AssetKind,
  a: string,
  b: string,
  now = 0,
): StoryboardDoc {
  const list = kind === 'char' ? doc.characters : doc.scenes
  if (a === b || !list.some((x) => x.id === a) || !list.some((x) => x.id === b)) return doc
  const key = pairKey(a, b)
  const current = doc.mergeDismissals ?? []
  if (current.includes(key)) return doc
  return { ...doc, mergeDismissals: [...current, key], updatedAt: now }
}

function withAsset(
  doc: StoryboardDoc,
  kind: AssetKind,
  id: string,
  patch: (asset: DramaAsset) => DramaAsset,
  now = 0,
): StoryboardDoc {
  if (kind === 'char') {
    const current = doc.characters.find((c) => c.id === id)
    if (!current) return doc
    const next = patch(current)
    if (next === current) return doc
    return { ...doc, characters: doc.characters.map((c) => (c.id === id ? next : c)), updatedAt: now }
  }
  const current = doc.scenes.find((s) => s.id === id)
  if (!current) return doc
  const next = patch(current)
  if (next === current) return doc
  return { ...doc, scenes: doc.scenes.map((s) => (s.id === id ? next : s)), updatedAt: now }
}

export function setAssetNode(
  doc: StoryboardDoc,
  kind: AssetKind,
  id: string,
  nodeId: string,
  now = 0,
): StoryboardDoc {
  return withAsset(
    doc,
    kind,
    id,
    (asset) => {
      if (asset.nodeId === nodeId) return asset
      const next: DramaAsset = { ...asset, nodeId }
      delete next.baseHash
      return next
    },
    now,
  )
}

export function setAssetBaseHash(
  doc: StoryboardDoc,
  kind: AssetKind,
  id: string,
  hash: string,
  now = 0,
): StoryboardDoc {
  return withAsset(
    doc,
    kind,
    id,
    (asset) => (asset.baseHash === hash ? asset : { ...asset, baseHash: hash }),
    now,
  )
}

export function setAssetTurnaroundNode(
  doc: StoryboardDoc,
  kind: AssetKind,
  id: string,
  nodeId: string,
  now = 0,
): StoryboardDoc {
  return withAsset(
    doc,
    kind,
    id,
    (asset) => {
      if (asset.turnaroundNodeId === nodeId) return asset
      const next: DramaAsset = { ...asset, turnaroundNodeId: nodeId }
      delete next.turnaroundHash
      return next
    },
    now,
  )
}

export function setAssetTurnaroundHash(
  doc: StoryboardDoc,
  kind: AssetKind,
  id: string,
  hash: string,
  now = 0,
): StoryboardDoc {
  return withAsset(
    doc,
    kind,
    id,
    (asset) => (asset.turnaroundHash === hash ? asset : { ...asset, turnaroundHash: hash }),
    now,
  )
}

export function shotsNeedingNode(
  shots: readonly StoryboardShot[],
  liveNodeIds: ReadonlySet<string>,
): StoryboardShot[] {
  return shots.filter((s) => !s.nodeId || !liveNodeIds.has(s.nodeId))
}

export function attachShotNodes(
  doc: StoryboardDoc,
  pairs: readonly { shotId: string; nodeId: string }[],
  now = 0,
): StoryboardDoc {
  if (pairs.length === 0) return doc
  const map = new Map(pairs.map((p) => [p.shotId, p.nodeId]))
  let changed = false
  const shots = doc.shots.map((s) => {
    const nodeId = map.get(s.id)
    if (!nodeId || s.nodeId === nodeId) return s
    changed = true
    const next: StoryboardShot = { ...s, nodeId }
    delete next.imageHash
    delete next.videoNodeId
    delete next.videoEndNodeId
    delete next.videoHash
    return next
  })
  return changed ? { ...doc, shots, updatedAt: now } : doc
}

export function attachShotImages(
  doc: StoryboardDoc,
  pairs: readonly { shotId: string; hash: string }[],
  now = 0,
): StoryboardDoc {
  if (pairs.length === 0) return doc
  const map = new Map(pairs.map((p) => [p.shotId, p.hash]))
  let changed = false
  const shots = doc.shots.map((s) => {
    const hash = map.get(s.id)
    if (!hash || s.imageHash === hash) return s
    changed = true
    return { ...s, imageHash: hash }
  })
  return changed ? { ...doc, shots, updatedAt: now } : doc
}

export function setShotVideoNode(
  doc: StoryboardDoc,
  shotId: string,
  videoNodeId: string,
  now = 0,
  videoEndNodeId = '',
): StoryboardDoc {
  let changed = false
  const shots = doc.shots.map((s) => {
    const nextEndNodeId = videoEndNodeId.trim()
    if (
      s.id !== shotId ||
      (s.videoNodeId === videoNodeId && (s.videoEndNodeId ?? '') === nextEndNodeId)
    ) {
      return s
    }
    changed = true
    const next: StoryboardShot = { ...s, videoNodeId }
    if (nextEndNodeId) next.videoEndNodeId = nextEndNodeId
    else delete next.videoEndNodeId
    delete next.videoHash
    return next
  })
  return changed ? { ...doc, shots, updatedAt: now } : doc
}

export function attachShotVideos(
  doc: StoryboardDoc,
  pairs: readonly { shotId: string; hash: string }[],
  now = 0,
): StoryboardDoc {
  if (pairs.length === 0) return doc
  const map = new Map(pairs.map((p) => [p.shotId, p.hash]))
  let changed = false
  const shots = doc.shots.map((s) => {
    const hash = map.get(s.id)
    if (!hash || s.videoHash === hash) return s
    changed = true
    return { ...s, videoHash: hash }
  })
  return changed ? { ...doc, shots, updatedAt: now } : doc
}

export function mergeStoryboardRunResults(
  current: StoryboardDoc,
  produced: StoryboardDoc,
  now = 0,
): StoryboardDoc {
  const producedAssets = new Map(
    [...produced.characters, ...produced.scenes].map((asset) => [
      asset.id,
      asset,
    ]),
  )
  const mergeAssets = (assets: DramaAsset[]): DramaAsset[] => {
    let changed = false
    const next = assets.map((asset) => {
      const source = producedAssets.get(asset.id)
      if (!source) return asset
      const merged: DramaAsset = {
        ...asset,
        ...(source.baseHash ? { baseHash: source.baseHash } : {}),
        ...(source.turnaroundHash ? { turnaroundHash: source.turnaroundHash } : {}),
      }
      if (
        merged.baseHash === asset.baseHash &&
        merged.turnaroundHash === asset.turnaroundHash
      ) {
        return asset
      }
      changed = true
      return merged
    })
    return changed ? next : assets
  }
  const producedShots = new Map(produced.shots.map((shot) => [shot.id, shot]))
  let shotsChanged = false
  const shots = current.shots.map((shot) => {
    const source = producedShots.get(shot.id)
    if (!source) return shot
    const producedLines = new Map(source.lines.map((line) => [line.id, line]))
    let linesChanged = false
    const lines = shot.lines.map((line) => {
      const producedLine = producedLines.get(line.id)
      if (!producedLine) return line
      const next: StoryboardLine = {
        ...line,
        ...(producedLine.audioHash ? { audioHash: producedLine.audioHash } : {}),
        ...(producedLine.audioName ? { audioName: producedLine.audioName } : {}),
      }
      if (
        next.audioHash === line.audioHash &&
        next.audioName === line.audioName
      ) {
        return line
      }
      linesChanged = true
      return next
    })
    const next: StoryboardShot = {
      ...shot,
      ...(source.imageHash ? { imageHash: source.imageHash } : {}),
      ...(source.videoHash ? { videoHash: source.videoHash } : {}),
      ...(linesChanged ? { lines } : {}),
    }
    if (
      next.imageHash === shot.imageHash &&
      next.videoHash === shot.videoHash &&
      !linesChanged
    ) {
      return shot
    }
    shotsChanged = true
    return next
  })
  const characters = mergeAssets(current.characters) as DramaCharacter[]
  const scenes = mergeAssets(current.scenes)
  const changed =
    characters !== current.characters ||
    scenes !== current.scenes ||
    shotsChanged
  return changed
    ? {
        ...current,
        characters,
        scenes,
        shots,
        updatedAt: now,
      }
    : current
}

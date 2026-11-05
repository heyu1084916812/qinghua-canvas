import type { StoryboardDoc, StoryboardShot } from './model'

/** 集顺序决定大块，块内保持原有先后；未知集排在末尾但不改变相对顺序。 */
export function normalizeShotOrder(doc: StoryboardDoc): StoryboardShot[] {
  const order = new Map(doc.episodes.map((e, index) => [e.id, index]))
  return doc.shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => {
      const ea = order.get(a.shot.episodeId) ?? Number.MAX_SAFE_INTEGER
      const eb = order.get(b.shot.episodeId) ?? Number.MAX_SAFE_INTEGER
      return ea === eb ? a.index - b.index : ea - eb
    })
    .map((entry) => entry.shot)
}

export function shotsOf(doc: StoryboardDoc, episodeId: string): StoryboardShot[] {
  return doc.shots.filter((s) => s.episodeId === episodeId)
}

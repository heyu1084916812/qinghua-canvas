import type { AssetKind, StoryboardDoc } from './model'

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export type { AssetKind }

export function assetListOf(doc: StoryboardDoc, kind: AssetKind) {
  return kind === 'char' ? doc.characters : doc.scenes
}

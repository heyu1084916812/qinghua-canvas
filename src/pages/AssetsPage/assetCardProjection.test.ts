import { describe, expect, it } from 'vitest'
import type { HistoryOutput } from '../../domain/shared/assetHistory'
import { cardAssetOf, timeLabelOf } from './assetCardProjection'

const historyOutput = (over: Partial<HistoryOutput> = {}): HistoryOutput => ({
  kind: 'output',
  hash: 'history-1',
  mime: 'image/png',
  bytes: 128,
  width: 320,
  height: 240,
  createdAt: 1_700_000_000_000,
  saved: false,
  prompt: 'fixture',
  model: 'image-model',
  tags: ['品牌'],
  ...over,
})

describe('asset card projection', () => {
  it('maps history metadata without changing the output time into savedAt', () => {
    expect(cardAssetOf(historyOutput())).toMatchObject({
      hash: 'history-1',
      mime: 'image/png',
      bytes: 128,
      width: 320,
      height: 240,
      savedAt: 1_700_000_000_000,
      tags: ['品牌'],
    })
  })

  it('omits empty tags and formats failure timestamps', () => {
    expect(cardAssetOf(historyOutput({ tags: [] }))).not.toHaveProperty('tags')
    expect(timeLabelOf(0)).toBe('')
    expect(timeLabelOf(1_700_000_000_000)).toMatch(/月.+日 \d{2}:\d{2}$/)
  })
})

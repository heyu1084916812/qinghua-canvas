import { describe, expect, it } from 'vitest'
import { sourceNodeIdOf } from './useLightboxFlip'

describe('sourceNodeIdOf', () => {
  const nodes = [
    { id: 'a', data: { assetHash: 'same' } },
    { id: 'b', data: { assetHash: 'same' } },
  ]

  it('prefers the clicked node when the asset is reused', () => {
    expect(sourceNodeIdOf(nodes, 'same', 'b')).toBe('b')
  })

  it('falls back to the first matching owner without a source node', () => {
    expect(sourceNodeIdOf(nodes, 'same')).toBe('a')
  })
})

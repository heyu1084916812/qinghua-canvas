import { describe, expect, it } from 'vitest'
import {
  kitMentionId,
  mergeSessionKits,
  normalizeSessionKits,
  parseKitMentionId,
  sameSessionKits,
} from './kitMention'

describe('kitMention', () => {
  it('id 冻结版本并可解析回来', () => {
    expect(kitMentionId('kit_a', 3)).toBe('kit_a@v3')
    expect(parseKitMentionId('kit_a@v3')).toEqual({ kitId: 'kit_a', version: 3 })
    expect(parseKitMentionId('kit_a')).toBeNull()
    expect(parseKitMentionId('kit_a@v0')).toBeNull()
  })

  it('合并会话套件：新 @ 的同一套件以本轮版本为准，其余保留', () => {
    const merged = mergeSessionKits(
      [{ kitId: 'a', version: 1, name: 'A' }, { kitId: 'b', version: 2, name: 'B' }],
      [{ id: 'a@v4', label: 'A 新' }, { id: 'bad', label: 'x' }],
    )
    expect(merged).toEqual([{ kitId: 'b', version: 2, name: 'B' }, { kitId: 'a', version: 4, name: 'A 新' }])
    expect(sameSessionKits(merged, merged)).toBe(true)
    expect(sameSessionKits(undefined, [])).toBe(true)
    expect(sameSessionKits(undefined, merged)).toBe(false)
  })

  it('落库行归一：丢弃坏行', () => {
    expect(normalizeSessionKits([{ kitId: 'a', version: 2, name: 'A' }, { kitId: 'b', version: 0 }, null, 'x'])).toEqual([
      { kitId: 'a', version: 2, name: 'A' },
    ])
    expect(normalizeSessionKits(undefined)).toEqual([])
  })
})

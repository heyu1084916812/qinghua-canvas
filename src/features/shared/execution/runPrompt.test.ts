import { describe, expect, it } from 'vitest'
import type { RunRequest } from '../../../domain/shared/execution/types'
import { actualPromptOf, applyCallOrdinal } from './runPrompt'

const request: RunRequest = {
  kind: 'image',
  channelId: 'c',
  model: 'm',
  prompt: '生成主图',
  inputs: [],
  params: {},
}

describe('runPrompt', () => {
  it('第一次调用保持原文，后续调用使用同一个序号后缀', () => {
    expect(actualPromptOf({ seq: 0, collectionItemId: null }, request)).toBe('生成主图')
    expect(actualPromptOf({ seq: 2, collectionItemId: 'item' }, request)).toBe(
      '生成主图（第 3 项）',
    )
  })

  it('applyCallOrdinal 返回新请求，不修改计划里的原请求', () => {
    const applied = applyCallOrdinal({ seq: 1, collectionItemId: null }, request)
    expect(applied.prompt).toBe('生成主图（第 2 次）')
    expect(request.prompt).toBe('生成主图')
  })
})

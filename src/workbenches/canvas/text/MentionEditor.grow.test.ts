import { describe, expect, it } from 'vitest'
import { syncMentionEditorHeight } from './MentionEditor'

describe('syncMentionEditorHeight', () => {
  it('measures again after content mounts so remount keeps the long-prompt height', () => {
    const style: { height: string } = { height: '24px' }
    syncMentionEditorHeight({
      style: style as CSSStyleDeclaration,
      scrollHeight: 168,
    })

    expect(style.height).toBe('168px')
  })
})

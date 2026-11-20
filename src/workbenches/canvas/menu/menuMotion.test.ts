import { describe, expect, it } from 'vitest'
import contextCss from './ContextMenu.module.css'
import linkCss from './LinkMenu.module.css'

describe('canvas menu dismissal motion', () => {
  it('exposes a non-interactive exit state for both menus', () => {
    expect(contextCss.menuClosing).toBeTruthy()
    expect(linkCss.menuClosing).toBeTruthy()
  })
})

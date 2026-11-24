import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentWelcome } from './AgentWelcome'

describe('AgentWelcome', () => {
  it('shows the canvas-agent capabilities and functional starter actions', () => {
    const html = renderToStaticMarkup(
      createElement(AgentWelcome, {
        skillCount: 15,
        onUseSuggestion: vi.fn(),
      }),
    )

    expect(html).toContain('从一句话，到一张画布')
    expect(html).toContain('拆解步骤、调用 Skill')
    expect(html).toContain('data-agent-welcome-suggestion="image"')
    expect(html).toContain('data-agent-welcome-suggestion="workflow"')
    expect(html).toContain('data-agent-welcome-suggestion="skill"')
    expect(html).toContain('Skill 15')
    expect(html).toContain('参考素材')
    expect(html).toContain('自动执行')
  })
})

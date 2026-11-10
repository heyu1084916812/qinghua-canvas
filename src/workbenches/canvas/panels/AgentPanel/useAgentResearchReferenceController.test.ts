import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryPlatform } from '../../../../platform/memory'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  addResearchCandidateToProject,
  type AddResearchReferenceResult,
} from './agentResearchReference'
import { useAgentResearchReferenceController } from './useAgentResearchReferenceController'

vi.mock('./agentResearchReference', () => ({
  addResearchCandidateToProject: vi.fn(),
}))

const candidate = {
  id: 'openverse:1',
  title: 'Reference',
  url: 'https://example.com/source',
  imageUrl: 'https://example.com/image.png',
  source: 'openverse',
}

describe('useAgentResearchReferenceController', () => {
  it('attaches the saved reference id to the current Agent session', async () => {
    const reference = {
      id: 'ref_search_hash',
      projectId: 'project-1',
      title: 'Reference',
      source: 'search' as const,
      kind: 'image' as const,
      assetHash: 'hash',
      what: 'Reference',
      createdAt: 1,
      updatedAt: 1,
    }
    vi.mocked(addResearchCandidateToProject).mockResolvedValue({
      ok: true,
      message: 'saved',
      item: reference,
    } satisfies AddResearchReferenceResult)
    const nextSession = { id: 'session-1' } as AgentSession
    const appendReferenceIds = vi.fn(async () => nextSession)
    const applySessionSnapshot = vi.fn()
    const notify = vi.fn()
    let add!: ReturnType<typeof useAgentResearchReferenceController>
    function Harness() {
      add = useAgentResearchReferenceController({
        platform: createMemoryPlatform(),
        projectId: 'project-1',
        current: nextSession,
        currentIdRef: { current: 'session-1' },
        appendReferenceIds,
        applySessionSnapshot,
        notify,
      })
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Harness))
    })

    await act(async () => {
      await add(candidate)
    })

    expect(appendReferenceIds).toHaveBeenCalledWith('session-1', [reference.id])
    expect(applySessionSnapshot).toHaveBeenCalledWith(nextSession)
    expect(notify).toHaveBeenCalledWith('saved', 'info')
  })
})

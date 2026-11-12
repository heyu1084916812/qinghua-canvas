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
    const insertMention = vi.fn()
    let research!: ReturnType<typeof useAgentResearchReferenceController>
    function Harness() {
      research = useAgentResearchReferenceController({
        platform: createMemoryPlatform(),
        projectId: 'project-1',
        current: nextSession,
        currentIdRef: { current: 'session-1' },
        appendReferenceIds,
        applySessionSnapshot,
        notify,
        insertMention,
      })
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Harness))
    })

    await act(async () => {
      await research.addResearchReference(candidate)
    })

    expect(appendReferenceIds).toHaveBeenCalledWith('session-1', [reference.id])
    expect(applySessionSnapshot).toHaveBeenCalledWith(nextSession)
    expect(notify).toHaveBeenCalledWith('saved', 'info')
  })

  it('inserts a saved reference chip when sending a research image to chat', async () => {
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
    const insertMention = vi.fn()
    let research!: ReturnType<typeof useAgentResearchReferenceController>
    function Harness() {
      research = useAgentResearchReferenceController({
        platform: createMemoryPlatform(),
        projectId: 'project-1',
        current: { id: 'session-1' } as AgentSession,
        currentIdRef: { current: 'session-1' },
        appendReferenceIds: vi.fn(async () => ({ id: 'session-1' }) as AgentSession),
        applySessionSnapshot: vi.fn(),
        notify: vi.fn(),
        insertMention,
      })
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Harness))
    })

    await act(async () => {
      await research.sendResearchToChat(candidate)
    })
    expect(insertMention).toHaveBeenCalledWith('reference', reference.id, reference.title)
  })

  it('downloads the selected research image through the file port', async () => {
    const platform = createMemoryPlatform()
    let research!: ReturnType<typeof useAgentResearchReferenceController>
    function Harness() {
      research = useAgentResearchReferenceController({
        platform,
        projectId: 'project-1',
        current: { id: 'session-1' } as AgentSession,
        currentIdRef: { current: 'session-1' },
        appendReferenceIds: vi.fn(),
        applySessionSnapshot: vi.fn(),
        notify: vi.fn(),
        insertMention: vi.fn(),
      })
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Harness))
    })

    await act(async () => {
      expect(await research.downloadResearchImage(candidate)).toMatchObject({
        ok: true,
      })
    })
  })
})

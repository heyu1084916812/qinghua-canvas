import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryPlatform } from '../../../../platform/memory'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  addResearchCandidateToProject,
  type AddResearchReferenceResult,
} from './agentResearchReference'
import {
  RESEARCH_IMAGE_SAVE_TIMEOUT_MS,
  useAgentResearchReferenceController,
} from './useAgentResearchReferenceController'
import { addResearchSourceReferenceToProject } from './researchSourceReference'

vi.mock('./agentResearchReference', () => ({
  addResearchCandidateToProject: vi.fn(),
  throwIfResearchAborted: (signal?: AbortSignal) => {
    if (signal?.aborted) throw signal.reason ?? new Error('aborted')
  },
  researchItemOf: vi.fn(),
  researchReferenceWhatOf: vi.fn(),
}))

vi.mock('./researchSourceReference', () => ({
  addResearchSourceReferenceToProject: vi.fn(),
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

  it('G-R2: commits staged images on send and returns reference mentions, without touching the draft', async () => {
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
      })
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Harness))
    })

    let commit!: Awaited<ReturnType<typeof research.commitResearchSelection>>
    await act(async () => {
      commit = await research.commitResearchSelection([candidate])
    })
    expect(commit.mentions).toEqual([`@[${reference.title}](reference:${reference.id})`])
    expect(commit.committed.map((row) => row.reference.id)).toEqual([reference.id])
    expect(commit.failed).toEqual([])
  })

  it('sends source context to chat when the image cannot be saved', async () => {
    vi.mocked(addResearchCandidateToProject).mockResolvedValue({
      ok: false,
      message: '图片读取失败：HTTP 403',
    })
    const fallback = {
      id: 'ref_search_source_candidate',
      projectId: 'project-1',
      title: 'Reference',
      source: 'search' as const,
      kind: 'text' as const,
      url: candidate.url,
      what: '图源：查看图片搜索结果',
      createdAt: 1,
      updatedAt: 1,
    }
    vi.mocked(addResearchSourceReferenceToProject).mockResolvedValue({
      ok: true,
      message: '图片未能保存，已把来源信息发送到对话',
      item: fallback,
    })
    const appendReferenceIds = vi.fn(async () => ({ id: 'session-1' }) as AgentSession)
    let research!: ReturnType<typeof useAgentResearchReferenceController>
    function Harness() {
      research = useAgentResearchReferenceController({
        platform: createMemoryPlatform(),
        projectId: 'project-1',
        current: { id: 'session-1' } as AgentSession,
        currentIdRef: { current: 'session-1' },
        appendReferenceIds,
        applySessionSnapshot: vi.fn(),
        notify: vi.fn(),
      })
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Harness))
    })

    let commit!: Awaited<ReturnType<typeof research.commitResearchSelection>>
    await act(async () => {
      commit = await research.commitResearchSelection([candidate])
    })

    expect(addResearchSourceReferenceToProject).toHaveBeenCalledWith(
      candidate,
      expect.objectContaining({ projectId: 'project-1' }),
    )
    expect(appendReferenceIds).toHaveBeenCalledWith('session-1', [fallback.id])
    expect(commit.mentions).toEqual([`@[${fallback.title}](reference:${fallback.id})`])
  })

  it('does not downgrade an explicit add-to-project failure into a text reference', async () => {
    vi.mocked(addResearchCandidateToProject).mockResolvedValue({
      ok: false,
      message: '图片读取失败：HTTP 403',
    })
    let research!: ReturnType<typeof useAgentResearchReferenceController>
    function Harness() {
      research = useAgentResearchReferenceController({
        platform: createMemoryPlatform(),
        projectId: 'project-1',
        current: { id: 'session-1' } as AgentSession,
        currentIdRef: { current: 'session-1' },
        appendReferenceIds: vi.fn(),
        applySessionSnapshot: vi.fn(),
        notify: vi.fn(),
      })
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Harness))
    })

    await act(async () => {
      expect(await research.addResearchReference(candidate)).toMatchObject({
        ok: false,
      })
    })

    expect(addResearchSourceReferenceToProject).not.toHaveBeenCalled()
  })

  it('puts a total deadline on the image save chain and aborts it', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(addResearchCandidateToProject).mockImplementation(
        async () => new Promise(() => {}),
      )
      const notify = vi.fn()
      let research!: ReturnType<typeof useAgentResearchReferenceController>
      function Harness() {
        research = useAgentResearchReferenceController({
          platform: createMemoryPlatform(),
          projectId: 'project-1',
          current: { id: 'session-1' } as AgentSession,
          currentIdRef: { current: 'session-1' },
          appendReferenceIds: vi.fn(),
          applySessionSnapshot: vi.fn(),
          notify,
        })
        return null
      }
      act(() => {
        TestRenderer.create(createElement(Harness))
      })

      let result: AddResearchReferenceResult | undefined
      await act(async () => {
        const pending = research.addResearchReference(candidate)
        await vi.advanceTimersByTimeAsync(RESEARCH_IMAGE_SAVE_TIMEOUT_MS + 1)
        result = await pending
      })

      expect(result).toMatchObject({ ok: false })
      expect(result?.message).toContain('超时')
      const signal = vi.mocked(addResearchCandidateToProject).mock.calls[0]?.[1]
        ?.signal
      expect(signal?.aborted).toBe(true)
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining('超时'),
        'error',
      )
    } finally {
      vi.useRealTimers()
    }
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

  it('B6: a cancel after the image was saved does not attach it to the session', async () => {
    const parent = new AbortController()
    vi.mocked(addResearchCandidateToProject).mockImplementation(async () => {
      parent.abort()
      return {
        ok: true,
        message: 'saved',
        item: {
          id: 'ref_late', projectId: 'project-1', title: 'Late', source: 'search', kind: 'image',
          assetHash: 'h', what: 'x', createdAt: 1, updatedAt: 1,
        },
      }
    })
    const appendReferenceIds = vi.fn(async () => ({ id: 'session-1' }) as AgentSession)
    const notify = vi.fn()
    let research!: ReturnType<typeof useAgentResearchReferenceController>
    function Harness() {
      research = useAgentResearchReferenceController({
        platform: createMemoryPlatform(),
        projectId: 'project-1',
        current: { id: 'session-1' } as AgentSession,
        currentIdRef: { current: 'session-1' },
        appendReferenceIds,
        applySessionSnapshot: vi.fn(),
        notify,
      })
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Harness))
    })
    let commit!: Awaited<ReturnType<typeof research.commitResearchSelection>>
    await act(async () => {
      commit = await research.commitResearchSelection([candidate], parent.signal)
    })
    expect(commit.committed).toEqual([])
    expect(commit.mentions).toEqual([])
    expect(commit.failed[0]?.message).toContain('已取消')
    expect(appendReferenceIds).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('B6: passes the action signal to the file port so a canceled download never lands', async () => {
    const platform = createMemoryPlatform()
    const saveFromUrl = vi.spyOn(platform.files, 'saveFromUrl')
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
      })
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Harness))
    })
    const parent = new AbortController()
    parent.abort()
    let result: { ok: boolean; message: string } | undefined
    await act(async () => {
      result = await research.downloadResearchImage(candidate, parent.signal)
    })
    expect(saveFromUrl.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal)
    expect(saveFromUrl.mock.calls[0]?.[2]?.aborted).toBe(true)
    expect(result).toMatchObject({ ok: false })
  })
})

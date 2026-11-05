import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { CanvasStoreProvider } from '../../storeContext'
import { IDLE_STATUS } from './AgentActivityViews'
import {
  useAgentPanelSessionPresentation,
  type AgentPanelSessionPresentationInput,
} from './useAgentPanelSessionPresentation'

function renderPresentation(
  graph: {
    nodes: Array<{
      id: string
      title?: string
      data?: { assetHash?: string }
    }>
  },
  input: Omit<AgentPanelSessionPresentationInput, 'status'>,
) {
  const store = {
    subscribe: vi.fn(() => () => {}),
    getSnapshot: () => graph,
  } as unknown as CanvasStore
  let current!: ReturnType<typeof useAgentPanelSessionPresentation>
  function Probe() {
    current = useAgentPanelSessionPresentation({
      ...input,
      status: IDLE_STATUS,
    })
    return null
  }
  let root!: TestRenderer.ReactTestRenderer
  act(() => {
    root = TestRenderer.create(
      createElement(CanvasStoreProvider, {
        store,
        children: createElement(Probe),
      }),
    )
  })
  return {
    get: () => current,
    unmount: () => act(() => root.unmount()),
  }
}

describe('useAgentPanelSessionPresentation', () => {
  it('把消息、节点标题与产物 hash 投影成同一次展示快照', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: '看看小猫',
        createdAt: 100,
      },
    ]
    const session: AgentSession = {
      id: 's1',
      projectId: 'p1',
      title: '会话',
      channelId: 'c1',
      model: 'm1',
      queuedTurns: [],
      pendingSteers: [],
      messages,
      createdAt: 1,
      updatedAt: 1,
    }
    const hook = renderPresentation(
      {
        nodes: [
          {
            id: 'n1',
            title: '小猫',
            data: { assetHash: 'hash-1' },
          },
        ],
      },
      {
        current: session,
        messages,
        composerHeight: 120,
      },
    )

    expect(hook.get().items).toHaveLength(1)
    expect(hook.get().items[0]).toMatchObject({
      kind: 'user',
      text: '看看小猫',
    })
    expect(hook.get().nodeLabelOf('n1')).toBe('小猫')
    expect(hook.get().hashOfNode.get('n1')).toBe('hash-1')
    hook.unmount()
  })
})

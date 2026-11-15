import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { Channel } from '../../domain/project/channel'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { NetworkResponse } from '../../platform/ports'
import { createMemoryPlatform } from '../../platform/memory'
import { ChannelError } from '../../platform/channels/types'
import { recheckWorkflowTask } from './workflowTaskRecheck'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const seen = vi.hoisted(() => ({ signal: null as AbortSignal | null, error: null as unknown, hang: false }))
vi.mock('../../state/channel/channelQuickTest', async (original) => ({
  ...(await original<typeof import('../../state/channel/channelQuickTest')>()),
  runChannelQuickTest: vi.fn(async (input: { signal: AbortSignal }) => {
    seen.signal = input.signal
    if (seen.hang) await new Promise(() => {})
    throw seen.error
  }),
}))
const { SettingsWorkflowTestRun } = await import('./SettingsWorkflowTestRun')

const json = (body: unknown): NetworkResponse => ({
  status: 200, headers: { 'content-type': 'application/json' },
  text: async () => JSON.stringify(body), json: async <T,>() => body as T, arrayBuffer: async () => new ArrayBuffer(0),
})
const netOf = (body: unknown) => ({ network: { request: vi.fn(async () => json(body)) } }) as never
const endpoint = { host: 'https://www.runninghub.cn', apiKey: 'k' }
const signal = new AbortController().signal

describe('再查一次（#1130 M10.1）', () => {
  it('SUCCESS → done 带产物；RUNNING → pending；FAILED / 顶层 errorCode → failed', async () => {
    expect(await recheckWorkflowTask(netOf({ taskId: 't', status: 'SUCCESS', results: [{ url: 'https://x/a.png' }] }), endpoint, 't', signal)).toMatchObject({ kind: 'done', text: expect.stringContaining('https://x/a.png') })
    expect((await recheckWorkflowTask(netOf({ taskId: 't', status: 'RUNNING', errorCode: '' }), endpoint, 't', signal)).kind).toBe('pending')
    expect(await recheckWorkflowTask(netOf({ taskId: 't', status: '', errorCode: '1004', errorMessage: 'Task not found' }), endpoint, 't', signal)).toMatchObject({ kind: 'failed', text: expect.stringContaining('1004') })
  })
})

const channel = { id: 'ch-rh', name: 'RunningHub', icon: null, protocol: 'runninghub-api', baseUrl: '', models: [], credentialGroups: [] } as unknown as Channel
const channels = { loadToken: async () => 'k', protocolCatalog: () => ({}) } as unknown as ChannelStore
const entry = { id: '1', kind: 'workflow' as const, title: 'w', provider: 'runninghub' as const, fields: [], fetchedAt: 1 }
const mount = () => {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(SettingsWorkflowTestRun, { channel, entry, channels, platform: createMemoryPlatform() }))
  })
  return renderer
}
const click = async (renderer: TestRenderer.ReactTestRenderer, label: string) => {
  const button = renderer.root.findAll((node) => node.type === 'button' && String(node.children.join('')).includes(label))[0]!
  await act(async () => {
    button.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('测试运行 · 停止等待（#1130 M10.1）', () => {
  it('★ 停止等待后显示任务 id 与「再查一次」', async () => {
    seen.hang = false
    seen.error = new ChannelError({ kind: 'execution', detail: 'accepted', message: 'RunningHub 任务 t-42 已提交，已停止等待（结果仍在上游，可凭任务 id 再查）' })
    const renderer = mount()
    await click(renderer, '测试运行')
    const box = renderer.root.findAll((node) => node.props['data-workflow-test-run-task'] === 't-42')
    expect(box).toHaveLength(1)
    expect(JSON.stringify(renderer.toJSON())).toContain('再查一次')
  })

  it('★ 运行中有「停止等待」；卸载时中止等待', async () => {
    seen.hang = true
    const renderer = mount()
    await click(renderer, '测试运行')
    expect(JSON.stringify(renderer.toJSON())).toContain('停止等待')
    expect(seen.signal?.aborted).toBe(false)
    act(() => renderer.unmount())
    expect(seen.signal?.aborted).toBe(true)
  })
})

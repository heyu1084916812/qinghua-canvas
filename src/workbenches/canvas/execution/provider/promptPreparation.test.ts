import { describe, expect, it, vi } from 'vitest'
import { registerAllSpecs } from '../../../../domain/canvas/nodeSpecs'
import type { GraphSnapshot } from '../../../../domain/canvas/model/graph'
import type { NodeSnapshot, PromptData } from '../../../../domain/canvas/model/node'
import {
  applyComposeFromDraft,
  applySelectedSkill,
  type CanvasPromptPreparationPorts,
} from './promptPreparation'

registerAllSpecs()

function promptNode(data: Partial<PromptData>): NodeSnapshot<PromptData> {
  return {
    id: 'prompt-1',
    projectId: 'p1',
    type: 'prompt',
    parentId: null,
    disabled: false,
    title: '提示词',
    x: 0,
    y: 0,
    w: 200,
    h: 120,
    data: {
      draft: '',
      text: '',
      ...data,
    } as PromptData,
  }
}

function graph(): GraphSnapshot {
  return { projectId: 'p1', nodes: [], edges: [] }
}

function setup(skills: CanvasPromptPreparationPorts['skills'] = () => []) {
  const completeText = vi.fn(async (_request?: unknown) => ' 生成正文 ')
  const ports: CanvasPromptPreparationPorts = {
    graph,
    dispatch: vi.fn(),
    notify: vi.fn(),
    skills,
    presetOverrides: {},
    completeText,
  }
  return { ports, completeText }
}

describe('canvas prompt preparation', () => {
  it('无技能时不触网', async () => {
    const { ports, completeText } = setup()
    const result = await applySelectedSkill(
      promptNode({ draft: 'draft' }),
      new AbortController().signal,
      ports,
    )
    expect(result).toBe('none')
    expect(completeText).not.toHaveBeenCalled()
    expect(ports.dispatch).not.toHaveBeenCalled()
  })

  it('已取消时不触网', async () => {
    const { ports, completeText } = setup(() => [{
      id: 'skill-1',
      name: 'Skill',
      content: 'system',
      inputMode: 'text',
    }])
    const abort = new AbortController()
    abort.abort()
    const result = await applySelectedSkill(
      promptNode({ skillId: 'skill-1', draft: 'draft', channelId: 'ch', model: 'm' }),
      abort.signal,
      ports,
    )
    expect(result).toBe('failed')
    expect(completeText).not.toHaveBeenCalled()
  })

  it('技能执行后写回正文且保留 signal 与显式请求字段', async () => {
    const { ports, completeText } = setup(() => [{
      id: 'skill-1',
      name: 'Skill',
      content: 'system',
      inputMode: 'text',
    }])
    const signal = new AbortController().signal
    const result = await applySelectedSkill(
      promptNode({ skillId: 'skill-1', draft: 'draft', channelId: 'ch', model: 'm' }),
      signal,
      ports,
    )
    expect(result).toBe('applied')
    expect(completeText).toHaveBeenCalledWith({
      channelId: 'ch',
      model: 'm',
      subjectId: 'prompt-1',
      purpose: 'skill',
      system: 'system',
      text: 'draft',
      inputs: [],
      signal,
    })
    expect(ports.dispatch).toHaveBeenCalledWith({
      kind: 'node.updateData',
      id: 'prompt-1',
      patch: { text: '生成正文' },
      transient: false,
    })
  })

  it('技能被删时清除选择并中止，不触网', async () => {
    const { ports, completeText } = setup()
    const result = await applySelectedSkill(
      promptNode({ skillId: 'gone', draft: 'draft', channelId: 'ch', model: 'm' }),
      new AbortController().signal,
      ports,
    )
    expect(result).toBe('failed')
    expect(completeText).not.toHaveBeenCalled()
    expect(ports.dispatch).toHaveBeenCalledWith({
      kind: 'node.updateData',
      id: 'prompt-1',
      patch: { skillId: undefined },
      transient: false,
    })
    expect(ports.notify).toHaveBeenCalledWith(
      '选中的技能已被删除，已取消选择，请重新选择后再生成',
      'error',
    )
  })

  it('草稿补文沿用 compose 的 purpose / signal，失败不写正文', async () => {
    const { ports, completeText } = setup()
    const signal = new AbortController().signal
    const result = await applyComposeFromDraft(
      promptNode({ draft: '写一只猫', channelId: 'ch', model: 'm' }),
      signal,
      ports,
    )
    expect(result).toBe('applied')
    const request = completeText.mock.calls[0]![0] as Record<string, unknown>
    expect(request).toMatchObject({
      subjectId: 'prompt-1',
      purpose: 'compose',
      channelId: 'ch',
      model: 'm',
      text: '写一只猫',
      signal,
    })
    expect(ports.dispatch).toHaveBeenCalledWith({
      kind: 'node.updateData',
      id: 'prompt-1',
      patch: { text: '生成正文' },
      transient: false,
    })
  })

  it('取消草稿补文不报失败提示', async () => {
    const { ports } = setup()
    const abort = new AbortController()
    abort.abort()
    const result = await applyComposeFromDraft(
      promptNode({ draft: '写一只猫', channelId: 'ch', model: 'm' }),
      abort.signal,
      ports,
    )
    expect(result).toBe('failed')
    expect(ports.notify).not.toHaveBeenCalled()
    expect(ports.dispatch).not.toHaveBeenCalled()
  })
})

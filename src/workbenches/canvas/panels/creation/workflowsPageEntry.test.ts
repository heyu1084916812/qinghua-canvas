import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { generationSpec } from '../../../../domain/canvas/nodeSpecs/generation'
import type { WorkflowEntry } from '../../../../domain/project/workflowParams'
import type { GenerationData } from '../../../../domain/canvas/model/node'
import { SourceModelMenu } from './SourceModelMenu'
import { useCreationSourceMenu } from './useCreationSourceMenu'
import type { WorkflowPanelSources } from './workflowPanelSources'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 创作面板 → 「AI 应用 / 工作流」页的入口（#1131 / #1134）：第四枚设置动作跟随「工作流」标签 */
const ENTRY: WorkflowEntry = {
  id: '1997246493079834625',
  title: '视频超分与补帧',
  provider: 'runninghub',
  fetchedAt: 0,
  kind: 'workflow',
  fields: [
    {
      id: '16::video',
      nodeId: '16',
      fieldName: 'video',
      type: 'video',
      label: '源视频',
      value: '',
      enabled: true,
      group: 'Load',
      options: [],
      min: null,
      max: null,
      step: null,
      seed: false,
      required: true,
      mediaOrder: 1,
    },
    {
      id: '65::strength',
      nodeId: '65',
      fieldName: 'strength',
      type: 'number',
      label: '超分强度',
      value: '0.8',
      enabled: true,
      group: 'SeedVR2',
      options: [],
      min: 0,
      max: 1,
      step: 0.05,
      seed: false,
      required: false,
      mediaOrder: 0,
    },
  ],
}

const SOURCES: WorkflowPanelSources = {
  channels: [{ id: 'ch-rh', name: 'RunningHub', protocol: 'runninghub-api', entries: [ENTRY] }],
}

const noop = () => {}
let seen = ''
function Where() {
  const location = useLocation()
  seen = `${location.pathname}${location.search}`
  return null
}
function Harness({ data }: { data: GenerationData }) {
  const menu = useCreationSourceMenu({
    data, workflowSources: SOURCES, enabled: [], allChannels: [], globalModelIds: [], wantedCategory: 'image', categoryLabel: '生图模型', ownedChannelId: '',
    apiLabel: 'GPT Image 2', iconForModel: () => undefined, recipeFor: () => ({}) as never, openPicker: null,
    onTogglePicker: noop, onClosePicker: noop, onEvent: () => { throw new Error('选「管理」不该改节点') }, enabledMenu: true,
  })
  return menu.picker
}
function manage(data: GenerationData) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(MemoryRouter, { initialEntries: ['/canvas/p1'] }, createElement(Harness, { data }), createElement(Where)))
  })
  const menu = renderer.root.findByType(SourceModelMenu)
  const tab = menu.props.tabs.find((item: { source: string }) => item.source === 'workflow')
  expect(tab.settings).toEqual({ label: '工作流设置', action: 'workflows' })
  act(() => menu.props.onSettings('workflows'))
  return seen
}

describe('创作面板里的「工作流设置」（#1131 / #1134）', () => {
  it('★ 工作流来源：第四枚设置动作 → 跳到管理页并落在当前条目', () => {
    const data = { ...generationSpec.createDefaultData(), model: `workflow:${ENTRY.id}`, channelId: 'ch-rh' }
    expect(manage(data)).toBe(`/workflows?channel=ch-rh&tab=workflow&entry=${ENTRY.id}`)
  })
  it('★ API 来源：切到「工作流」标签后使用工作流设置 → 跳到管理页首页', () => {
    const data = { ...generationSpec.createDefaultData(), model: 'GPT Image 2', channelId: 'ch-x' }
    expect(manage(data)).toBe('/workflows')
  })
})

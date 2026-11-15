import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { generationSpec } from '../../../../domain/canvas/nodeSpecs/generation'
import type { WorkflowEntry } from '../../../../domain/project/workflowParams'
import { ParamPicker } from '../ParamPicker'
import { WorkflowEntryLauncher, WorkflowParameterControls } from './WorkflowParameterControls'
import { MANAGE_WORKFLOWS_OPTION } from './useOpenWorkflowsPage'
import type { WorkflowPanelSources } from './workflowPanelSources'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 创作面板 → 「AI 应用 / 工作流」页的入口（#1131）：条目下拉与 API 模式的入口 chip 末尾各有一行「管理…」 */
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
function pick(element: ReturnType<typeof createElement>, name: string) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(MemoryRouter, { initialEntries: ['/canvas/p1'] }, element, createElement(Where)))
  })
  const picker = renderer.root.findAll((node) => node.type === ParamPicker && node.props.name === name)[0]!
  expect(picker.props.options.at(-1)).toMatchObject({ value: MANAGE_WORKFLOWS_OPTION, label: '管理 AI 应用 / 工作流…' })
  act(() => picker.props.onSelect(MANAGE_WORKFLOWS_OPTION))
  return seen
}

describe('创作面板里的「管理 AI 应用 / 工作流…」（#1131）', () => {
  it('★ 工作流模式：条目下拉末行 → 跳到管理页并落在当前条目', () => {
    const data = { ...generationSpec.createDefaultData(), model: `workflow:${ENTRY.id}`, channelId: 'ch-rh' }
    const where = pick(createElement(WorkflowParameterControls, { data, sources: SOURCES, openPicker: null, onTogglePicker: noop, onClosePicker: noop, onEvent: () => { throw new Error('选「管理」不该改节点') } }), 'model')
    expect(where).toBe(`/workflows?channel=ch-rh&tab=workflow&entry=${ENTRY.id}`)
  })
  it('★ API 模式：「工作流」入口 chip 末行 → 跳到管理页', () => {
    const where = pick(createElement(WorkflowEntryLauncher, { sources: SOURCES, openPicker: null, onTogglePicker: noop, onClosePicker: noop, onEvent: () => { throw new Error('选「管理」不该改节点') } }), 'workflowEntry')
    expect(where).toBe('/workflows')
  })
})

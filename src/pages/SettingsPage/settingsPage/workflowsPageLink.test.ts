import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetGlobalSettingsForTest,
  getGlobalSettings,
  openChannelSettings,
  openGlobalSettings,
} from '../../../state/ui/globalSettings'
import { initialSelectedChannelId, useWorkflowsPageOpener } from './workflowsPageLink'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** workflowsPageLink.ts：渠道页 → 「AI 应用 / 工作流」页（#1131） */
function Probe({ embedded, onReady }: { embedded: boolean; onReady: (open: (id: string) => void, path: () => string) => void }) {
  const open = useWorkflowsPageOpener(embedded)
  const location = useLocation()
  onReady(open, () => `${location.pathname}${location.search}`)
  return null
}

function mount(embedded: boolean) {
  let open: (id: string) => void = () => {}
  let path = () => ''
  act(() => {
    TestRenderer.create(
      createElement(MemoryRouter, { initialEntries: ['/settings'] }, createElement(Probe, { embedded, onReady: (o, p) => { open = o; path = p } })),
    )
  })
  return { open: (id: string) => act(() => open(id)), path: () => path() }
}

afterEach(() => {
  __resetGlobalSettingsForTest()
  vi.unstubAllGlobals()
})

describe('workflowsPageLink（#1131）', () => {
  it('整页设置：带渠道 id 跳到 /workflows，不碰全局设置浮层', () => {
    const view = mount(false)
    view.open('ch_builtin_runninghub_global')
    expect(view.path()).toBe('/workflows?channel=ch_builtin_runninghub_global')
  })

  it('嵌在全局设置浮层里：先关浮层再跳，免得新页面压在浮层下', () => {
    openGlobalSettings('channels')
    expect(getGlobalSettings().open).toBe(true)
    const view = mount(true)
    view.open('ch_builtin_runninghub')
    expect(getGlobalSettings().open).toBe(false)
    expect(view.path()).toBe('/workflows?channel=ch_builtin_runninghub')
  })

  it('initialSelectedChannelId：/settings?channel=<id> 落在那条渠道；无 window 时为 null', () => {
    expect(initialSelectedChannelId()).toBeNull()
    vi.stubGlobal('window', { location: { search: '?channel=ch_builtin_runninghub_global' } })
    expect(initialSelectedChannelId()).toBe('ch_builtin_runninghub_global')
    vi.stubGlobal('window', { location: { search: '' } })
    expect(initialSelectedChannelId()).toBeNull()
  })

  /** 对账 #1152：`/workflows` 的「渠道与 Key」改成开浮层后，目标渠道走状态而不是 URL */
  it('★★ 浮层带过来的目标渠道优先于 URL 参数', () => {
    openChannelSettings('ch_wf_target')
    vi.stubGlobal('window', { location: { search: '?channel=ch_from_url' } })
    expect(initialSelectedChannelId()).toBe('ch_wf_target')
  })
})

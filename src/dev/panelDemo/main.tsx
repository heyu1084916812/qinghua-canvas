import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AssetPlatformProvider } from '../../features/shared/assets/AssetPlatformContext'
import { ChannelStoreContext } from '../../app/providers/ChannelStoreProvider'
import { SkillStoreContext } from '../../app/providers/SkillStoreContext'
import { createMemoryPlatform } from '../../platform/memory'
import { createChannelStore } from '../../state/channel/channelStore'
import { generationSpec } from '../../domain/canvas/nodeSpecs/generation'
import { workflowEntriesRowId, type WorkflowEntry } from '../../domain/project/workflowParams'
import { CreationPanel } from '../../workbenches/canvas/panels/CreationPanel'
import { promptReferenceThumb, type PanelModel } from '../../workbenches/canvas/panels/panelModel'
import type { WorkflowPanelSources } from '../../workbenches/canvas/panels/creation/workflowPanelSources'
import '../../ui/tokens.css'
import '../../ui/base.css'
import './demo.css'

/**
 * 创作面板示例（**只读演示**，不进产品代码）：
 * 用**真实的 `CreationPanel`** 渲染「工作流模式」——
 * 参数行就是产品里那一行（条目 / 实例 / 参数摘要 + 原来那枚生成按钮）。
 *
 * 打开：`npm run dev:vite` 后访问 `/dev/panel-demo.html`。
 */

const CHANNEL_ID = 'ch_builtin_runninghub'
const WORKFLOW_ID = '2120459469214134274'

const ENTRY: WorkflowEntry = {
  id: WORKFLOW_ID,
  title: '视频超分与补帧',
  provider: 'runninghub',
  fetchedAt: Date.now(),
  kind: 'workflow',
  outputKind: 'video',
  fields: [
    {
      id: '16::video',
      nodeId: '16',
      fieldName: 'video',
      type: 'video',
      label: '源视频',
      value: '',
      enabled: true,
      group: 'VHS_LoadVideo',
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
    {
      id: '20::ratio',
      nodeId: '20',
      fieldName: 'ratio',
      type: 'select',
      label: '比例',
      value: '16:9',
      enabled: true,
      group: 'RIFE VFI',
      options: ['16:9', '9:16', '1:1'],
      min: null,
      max: null,
      step: null,
      seed: false,
      required: false,
      mediaOrder: 0,
    },
  ],
}

const emptySkills = {
  skills: [],
  builtinSkills: [],
  userSkills: [],
  loading: false,
  reload: async () => {},
  create: async () => {
    throw new Error('unused')
  },
  save: async () => {},
  remove: async () => {},
  copyBuiltin: async () => {
    throw new Error('unused')
  },
  restoreBuiltin: async () => {
    throw new Error('unused')
  },
}

const panelModel: PanelModel = {
  thumbs: [
    promptReferenceThumb({
      id: 'prompt-demo',
      text: '把这段视频提升到 4K，并补到 60 帧',
      edgeId: 'edge-demo',
      visible: true,
    }),
  ],
  collections: [],
  emptyHint: '连线上游节点，或拖入素材',
  prompt: '把这段视频提升到 4K，并补到 60 帧',
  promptToggle: null,
  mentionCandidates: [],
  preset: null,
  presetOptions: {},
  emotion: null,
}

async function boot() {
  const platform = createMemoryPlatform()
  await platform.storage.put('presets', {
    id: workflowEntriesRowId(CHANNEL_ID),
    entries: [ENTRY],
  } as never)

  const channels = createChannelStore(platform)
  await channels.load()
  if (channels.getState().channels.some((channel) => channel.id === CHANNEL_ID)) {
    await channels.setEnabled(CHANNEL_ID, true)
    await channels.setModels(CHANNEL_ID, [
      { id: 'GPT Image 2', category: 'image', inputTypes: ['text'] },
      { id: `workflow:${WORKFLOW_ID}`, category: 'video', inputTypes: ['text', 'image'] },
    ])
  }

  const workflowData = {
    ...generationSpec.createDefaultData(),
    mode: 'video' as const,
    channelId: CHANNEL_ID,
    model: `workflow:${WORKFLOW_ID}`,
    prompt: panelModel.prompt,
    workflowNodeInfoList: [
      { nodeId: '65', fieldName: 'strength', fieldValue: '0.8' },
      { nodeId: '20', fieldName: 'ratio', fieldValue: '16:9' },
    ],
  }
  const workflowSources: WorkflowPanelSources = {
    channels: [{ id: CHANNEL_ID, name: 'RunningHub', protocol: 'runninghub-api', entries: [ENTRY] }],
  }

  const container = document.getElementById('root')!
  createRoot(container).render(
    <StrictMode>
      <AssetPlatformProvider platform={platform}>
        <ChannelStoreContext.Provider value={channels}>
          <SkillStoreContext.Provider value={emptySkills}>
            <div className="demo-stage">
              <div className="demo-col">
                <h2 className="demo-caption">创作面板 · 工作流模式（真实组件）</h2>
                <div className="demo-panel">
                  <CreationPanel
                    data={workflowData}
                    model={panelModel}
                    running={false}
                    globalRunning={false}
                    error={null}
                    onEvent={() => {}}
                    onClose={() => {}}
                    showCategoryToggle
                    workflowSources={workflowSources}
                  />
                </div>
              </div>
            </div>
          </SkillStoreContext.Provider>
        </ChannelStoreContext.Provider>
      </AssetPlatformProvider>
    </StrictMode>,
  )
}

void boot()

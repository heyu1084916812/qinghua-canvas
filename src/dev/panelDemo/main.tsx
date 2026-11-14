import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ChannelStoreContext } from '../../app/providers/ChannelStoreProvider'
import { SkillStoreContext } from '../../app/providers/SkillStoreProvider'
import { createMemoryPlatform } from '../../platform/memory'
import { createChannelStore } from '../../state/channel/channelStore'
import { generationSpec } from '../../domain/canvas/nodeSpecs/generation'
import { workflowEntriesRowId, type WorkflowEntry } from '../../domain/project/workflowParams'
import { CreationPanel } from '../../workbenches/canvas/panels/CreationPanel'
import type { PanelModel } from '../../workbenches/canvas/panels/panelModel'
import { SourceRowDemo } from './SourceRowDemo'
import '../../ui/tokens.css'
import '../../ui/base.css'
import './demo.css'

/**
 * 创作面板示例（**只读演示**，不进产品代码）：
 * 用现有的 `CreationPanel` + 假数据渲染真面板，底部接一条"来源行"示意。
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
  thumbs: [],
  collections: [],
  emptyHint: '连线上游节点，或拖入素材',
  prompt: '把这段视频提升到 4K，并补到 60 帧',
  linkedPromptCount: 0,
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
      { id: 'app:1877265245566922753', category: 'image', inputTypes: ['text', 'image'] },
      { id: `workflow:${WORKFLOW_ID}`, category: 'video', inputTypes: ['text', 'image'] },
    ])
  }

  const data = {
    ...generationSpec.createDefaultData(),
    mode: 'video' as const,
    channelId: CHANNEL_ID,
    model: `workflow:${WORKFLOW_ID}`,
    prompt: panelModel.prompt,
  }

  const container = document.getElementById('root')!
  createRoot(container).render(
    <StrictMode>
      <ChannelStoreContext.Provider value={channels}>
        <SkillStoreContext.Provider value={emptySkills}>
          <div className="demo-stage">
            <p className="demo-caption">
              下面是现有的创作面板组件（真实 CreationPanel + 假数据）；底部那条是「来源行」示例。
            </p>
            <div className="demo-panel">
              <CreationPanel
                data={data}
                model={panelModel}
                running={false}
                globalRunning={false}
                error={null}
                onEvent={() => {}}
                onClose={() => {}}
                showCategoryToggle
              />
              <SourceRowDemo channelId={CHANNEL_ID} entries={[ENTRY]} />
            </div>
          </div>
        </SkillStoreContext.Provider>
      </ChannelStoreContext.Provider>
    </StrictMode>,
  )
}

void boot()

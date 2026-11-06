import type { GenerationData } from '../../../../domain/canvas/model/node'
import type { PromptToolAction } from '../../../../features/shared/promptTools/promptTools'
import type { PromptToolTarget } from '../../../../features/shared/promptTools/usePromptTools'
import type { PanelEvent, PanelModel } from '../panelModel'

/** 提示词节点的 LLM 工具状态（由 PanelLayer 持有 usePromptTools 并下传，§6.7） */
export interface PanelPromptTools {
  status: 'idle' | 'running' | 'error'
  error: string | null
  run: (text: string, action: PromptToolAction, target?: PromptToolTarget) => void
}

export interface CreationPanelProps {
  /** 当前节点 id；面板实例会在不同节点间复用。 */
  nodeId?: string
  data: GenerationData
  model: PanelModel
  disabled?: boolean
  running: boolean
  globalRunning: boolean
  error: string | null
  onEvent: (event: PanelEvent) => void
  onClose: () => void
  mode?: 'generation' | 'prompt'
  promptTools?: PanelPromptTools | null
  onOpenSkills?: () => void
  promptImageCount?: number
  showCategoryToggle?: boolean
  hasSourceImage?: boolean
  runsDownstream?: boolean
}

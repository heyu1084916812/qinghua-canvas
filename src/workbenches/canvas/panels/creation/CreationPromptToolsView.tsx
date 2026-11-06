import type { PromptToolAction } from '../../../../features/shared/promptTools/promptTools'
import type { PanelModel } from '../panelModel'
import type { PanelPromptTools } from './creationPanelTypes'
import { SkillPicker } from '../SkillPicker'
import { creationStyles as styles } from './creationStyles'

interface CreationPromptToolsViewProps {
  promptMode: boolean
  tools: PanelPromptTools | null
  skills: React.ComponentProps<typeof SkillPicker>['skills']
  model: PanelModel
  promptImageCount: number
  onSelectSkill: (skillId: string | null) => void
  onOpenSkills?: () => void
  onRunTool: (action: PromptToolAction) => void
}

export function CreationPromptToolsView({
  promptMode,
  tools,
  skills,
  model,
  promptImageCount,
  onSelectSkill,
  onOpenSkills,
  onRunTool,
}: CreationPromptToolsViewProps) {
  if (!promptMode || !tools) return null

  return (
    <span className={styles.toolGroup} data-panel-prompt-tools>
      <SkillPicker
        skills={skills}
        running={tools.status === 'running'}
        text={model.prompt}
        imageCount={promptImageCount}
        selectedId={model.selectedSkillId ?? null}
        onSelect={onSelectSkill}
        onOpenLibrary={onOpenSkills}
      />
      <button
        type="button"
        className={styles.toolBtn}
        disabled={tools.status === 'running' || model.prompt.trim().length === 0}
        title={tools.error ?? '用文本模型优化此提示词'}
        onClick={() => onRunTool('optimize')}
      >
        优化
      </button>
      <button
        type="button"
        className={styles.toolBtn}
        disabled={tools.status === 'running' || model.prompt.trim().length === 0}
        title={tools.error ?? '中文 ⇄ 英文互译'}
        onClick={() => onRunTool('translate')}
      >
        翻译
      </button>
      <button
        type="button"
        className={styles.toolBtn}
        data-panel-prompt-tool="describe"
        disabled={tools.status === 'running' || promptImageCount === 0}
        title={
          tools.error ??
          (promptImageCount > 0
            ? `把上游 ${promptImageCount} 张图发给文本模型，反推出绘画提示词（覆盖当前文本）`
            : '反推需要上游图片：先把一个已出图的生成节点连到本节点')
        }
        onClick={() => onRunTool('describe')}
      >
        反推
      </button>
    </span>
  )
}

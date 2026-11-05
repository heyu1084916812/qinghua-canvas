/** 创作面板的模型展示选项：只做目录投影，不拥有渠道状态。 */
import { panelModelOptions } from '../../../../domain/project/modelCatalog'
import type { ModelCapability } from '../../../../domain/shared/capability'

export interface CreationModelOption {
  value: string
  label: string
  icon?: React.ReactNode
}

export interface CreationModelOptionContext {
  wantedCategory: ModelCapability['category']
  uncommonModelIds: readonly string[]
  globalModelIds: readonly string[]
  iconFor(name: string): React.ReactNode | undefined
}

export function creationModelNames(input: {
  wantedCategory: ModelCapability['category']
  uncommonModelIds: readonly string[]
  globalModelIds: readonly string[]
}): string[] {
  return input.wantedCategory === 'chat'
    ? panelModelOptions('chat', input.uncommonModelIds)
    : [...input.globalModelIds]
}

export function creationModelOptions(context: CreationModelOptionContext): CreationModelOption[] {
  return creationModelNames(context).map((name) => {
    const icon = context.iconFor(name)
    return { value: name, label: name, ...(icon ? { icon } : {}) }
  })
}

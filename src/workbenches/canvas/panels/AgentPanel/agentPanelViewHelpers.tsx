import type { Rect } from '../../../../domain/agent/landing'
import { presetOf } from '../../../../domain/project/modelCatalog'
import type { PresetVendor } from '../../../../domain/project/modelPresets'
import { ModelIcon } from '../../../../features/shared/modelIcon/ModelIcon'

/**
 * 模型候选 -> 带厂商图标的选项。
 *
 * 这里只负责把已有模型名映射成菜单数据，不推导模型能力，也不决定路由。
 * `selected` 只表示“已经放进当前正文”，不是“当前会话默认模型”。
 */
export function withModelIcons(
  names: readonly string[],
  selected?: ReadonlySet<string>,
  modelOf: (name: string) => { vendor: PresetVendor } | undefined = presetOf,
) {
  return names.map((name) => {
    const preset = modelOf(name)
    return {
      value: name,
      label: name,
      ...(preset ? { icon: <ModelIcon vendor={preset.vendor} /> } : {}),
      ...(selected ? { selected: selected.has(name) } : {}),
    }
  })
}

/** 新节点落在视口中心偏左，保证用户在当前视野内看到结果。 */
export function originOf(vp: { x: number; y: number }): { x: number; y: number } {
  return { x: vp.x + 120, y: vp.y + 120 }
}

export function viewportWorldOf(vp: {
  x: number
  y: number
  zoom: number
}): Rect {
  const surface = document.querySelector<HTMLElement>('[data-canvas-surface]')
  const width = surface?.clientWidth ?? window.innerWidth
  const height = surface?.clientHeight ?? window.innerHeight
  return {
    x: vp.x,
    y: vp.y,
    w: width / Math.max(0.01, vp.zoom),
    h: height / Math.max(0.01, vp.zoom),
  }
}

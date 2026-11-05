/** 组件域 CSS 合并后仍以 `styles.xxx` 的原有键暴露，渲染树不改类名引用。 */
import baseStyles from './CreationPanelBase.module.css'
import assetsStyles from './CreationPanelAssets.module.css'
import promptStyles from './CreationPanelPrompt.module.css'
import paramsStyles from './CreationPanelParams.module.css'

export const creationStyles = {
  ...baseStyles,
  ...assetsStyles,
  ...promptStyles,
  ...paramsStyles,
}

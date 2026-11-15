import { useInRouterContext, useNavigate } from 'react-router-dom'
import { workflowsPagePath } from '../../../domain/project/workflowsPage'
import { closeGlobalSettings } from '../../../state/ui/globalSettings'

/**
 * 渠道页 → 「AI 应用 / 工作流」独立页（#1131）。嵌在全局设置浮层里时先关浮层，
 * 免得新页面压在浮层下面；不在路由里（静态渲染）时退回整页跳转。
 */
export function useWorkflowsPageOpener(embedded: boolean): (channelId: string) => void {
  /* 同一个组件里「在不在路由里」整个生命周期不变，条件调用 hook 是安全的 */
  const navigate = useInRouterContext() ? useNavigate() : null
  return (channelId: string) => {
    const path = workflowsPagePath({ channelId })
    if (embedded) closeGlobalSettings()
    if (navigate) navigate(path)
    else window.location.assign(path)
  }
}

/** `/settings?channel=<id>`：从「AI 应用 / 工作流」页的「渠道与 Key」跳回来时直接落在那条渠道 */
export function initialSelectedChannelId(): string | null {
  return typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('channel')
}

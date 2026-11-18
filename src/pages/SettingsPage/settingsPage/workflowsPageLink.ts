import { useInRouterContext, useNavigate } from 'react-router-dom'
import { workflowsPagePath } from '../../../domain/project/workflowsPage'
import { closeGlobalSettings, getGlobalSettings } from '../../../state/ui/globalSettings'

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

/**
 * 「模型服务」视图初始选中哪条渠道。两条来源，浮层优先：
 *
 * 1. `openChannelSettings(id)` 写进浮层状态的**本次目标渠道**（对账 #1152：`/workflows`
 *    的「渠道与 Key」不再跳 `/settings` 整页路由，而是直接开浮层落在这条渠道上）；
 * 2. `/settings?channel=<id>` 的 URL 参数（整页路由 / 外部深链仍走这条）。
 */
export function initialSelectedChannelId(): string | null {
  const pending = getGlobalSettings().channelId
  if (pending) return pending
  return typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('channel')
}

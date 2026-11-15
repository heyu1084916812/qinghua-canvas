/**
 * 「AI 应用 / 工作流」独立页的地址（#1131）。
 *
 * 渠道页的入口、创作面板工作流模式里的「管理…」都跳到这里；地址里带上渠道 / 标签 / 条目，
 * 跳过去就落在用户刚才看的那条，而不是每次都从国内站的应用列表重新找。
 */
export type WorkflowsTab = 'app' | 'workflow'

export const WORKFLOWS_PAGE_PATH = '/workflows'

export interface WorkflowsPageQuery {
  channelId: string | null
  tab: WorkflowsTab
  entryId: string | null
}

export function workflowsPagePath(query: Partial<WorkflowsPageQuery> = {}): string {
  const params = new URLSearchParams()
  if (query.channelId) params.set('channel', query.channelId)
  if (query.tab) params.set('tab', query.tab)
  if (query.entryId) params.set('entry', query.entryId)
  const text = params.toString()
  return text ? `${WORKFLOWS_PAGE_PATH}?${text}` : WORKFLOWS_PAGE_PATH
}

export function parseWorkflowsPageQuery(search: string): WorkflowsPageQuery {
  const params = new URLSearchParams(search)
  const pick = (key: string) => {
    const value = params.get(key)?.trim()
    return value ? value : null
  }
  return {
    channelId: pick('channel'),
    tab: params.get('tab') === 'workflow' ? 'workflow' : 'app',
    entryId: pick('entry'),
  }
}

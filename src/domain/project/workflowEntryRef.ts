/**
 * 「导入条目」输入框里那一串 → 条目 id 与种类（#1128 L4）。
 *
 * 认得的写法（RunningHub 国内站 / 国际站同一套路径）：
 * - AI 应用：`/run/ai-app/<id>`、`/ai-detail/<id>`（应用详情页，最常被复制的那条）、`webapp/<id>`、`webappId=<id>`；
 * - 工作流：`/run/workflow/<id>`、`/workflow/<id>`、`workflowId=<id>`；
 * - 纯数字 id：**种类不定**（`kind: null`），调用方先按工作流拉、拉不到再按应用试——
 *   上一版一律当工作流，粘贴应用 id 就报「工作流不存在」。
 */
export type WorkflowEntryRef = { id: string; kind: 'workflow' | 'app' | null }

export function parseWorkflowEntryRef(raw: string): WorkflowEntryRef | null {
  const text = raw.trim()
  if (!text) return null
  const app = /(?:ai-app|ai-detail|webapp)\/(\d{6,})|webappId=(\d{6,})/i.exec(text)
  if (app) return { id: (app[1] ?? app[2])!, kind: 'app' }
  const flow = /workflow\/(\d{6,})|workflowId=(\d{6,})/i.exec(text)
  if (flow) return { id: (flow[1] ?? flow[2])!, kind: 'workflow' }
  const bare = /^(\d{6,})$/.exec(text)
  return bare ? { id: bare[1]!, kind: null } : null
}

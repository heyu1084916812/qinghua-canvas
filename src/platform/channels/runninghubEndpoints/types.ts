/**
 * 目录数据类型（**自动生成，别手改**）
 *
 * 生成：`node scripts/gen-runninghub-models.mjs <RH_CLI>/src/rh_cli/catalog/data/capabilities.json`
 * 来源：RunningHub 官方 CLI（github.com/HM-RunningHub/RH_CLI）随包附带的端点目录
 *       capabilities.json —— version 2026-06-02，共 356 个端点；
 *       本批只留**精挑的 62 个端点 / 49 个模型**。
 *
 * 官方 CLI 建请求体的最后一步是「**必填 + 有默认值**而还没填的参数一律补默认值」
 * （`model/payload.py`）—— 适配器照同一条规则走 `requiredDefaults`。
 */

export interface RunningHubMediaParam {
  key: string
  type: 'IMAGE' | 'VIDEO' | 'AUDIO'
  multiple?: boolean
  required?: boolean
}

export interface RunningHubDrivenParam {
  key: string
  options?: string[]
}

export interface RunningHubEndpointSpec {
  id: string
  /** 目录里的任务类型，给日志与排查用 */
  task: string
  kind: 'image' | 'video'
  /** 目录里的中文名（原样，不加工） */
  label: string
  promptKey?: string
  media?: RunningHubMediaParam
  secondaryMedia?: RunningHubMediaParam
  audio?: RunningHubMediaParam
  ratio?: RunningHubDrivenParam
  resolution?: RunningHubDrivenParam
  duration?: RunningHubDrivenParam
  fps?: RunningHubDrivenParam
  scale?: RunningHubDrivenParam
  requiredDefaults?: Record<string, unknown>
}

/** 轻画里出现的模型（下拉里的一行 = 一个模型，不是"一个端点"） */
export interface RunningHubModel {
  id: string
  hint: string
  kind: 'image' | 'video'
  textEndpoint: string
  imageEndpoint?: string
}

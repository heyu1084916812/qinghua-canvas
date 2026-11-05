/**
 * 公共导出门面（**自动生成，别手改**）
 *
 * 生成：`node scripts/gen-runninghub-models.mjs <RH_CLI>/src/rh_cli/catalog/data/capabilities.json`
 * 来源：RunningHub 官方 CLI（github.com/HM-RunningHub/RH_CLI）随包附带的端点目录
 *       capabilities.json —— version 2026-06-02，共 356 个端点；
 *       本批只留**精挑的 62 个端点 / 49 个模型**。
 *
 * 官方 CLI 建请求体的最后一步是「**必填 + 有默认值**而还没填的参数一律补默认值」
 * （`model/payload.py`）—— 适配器照同一条规则走 `requiredDefaults`。
 */

export {
  RUNNINGHUB_ENDPOINT_SPECS,
  RUNNINGHUB_MODELS,
} from './runninghubEndpoints/contracts'
export type {
  RunningHubDrivenParam,
  RunningHubEndpointSpec,
  RunningHubMediaParam,
  RunningHubModel,
} from './runninghubEndpoints/types'

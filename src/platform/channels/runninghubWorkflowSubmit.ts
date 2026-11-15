import type { PlatformKit } from '../ports'
import { ChannelError } from './types'
import { submitV2Task } from './runninghubV2'
import { describeRhError, type RhErrorEnvelope } from './runninghubErrorText'
import { postJson, type WorkflowEndpoint } from './runninghubWorkflowHttp'

/**
 * RunningHub 工作流 / AI 应用的**提交**（对账 #1104 / #1126）。
 *
 * 先走 v2 全 Bearer（`/openapi/v2/run/{workflow|ai-app}/{id}`），站点回 `1001`（没有这条路由）
 * 才退回旧接口 `/task/openapi/create`、`/task/openapi/ai-app/run`（请求体带 `apiKey`）。
 * 从 `runninghubWorkflow.ts` 拆出来是为了 450 行预算；`runninghubWorkflow.ts` 原样再导出。
 */

const CREATE_PATH = '/task/openapi/create'
const APP_RUN_PATH = '/task/openapi/ai-app/run'
const SUBMIT_TIMEOUT_MS = 60_000

/**
 * 提交工作流任务。`nodeInfoList` 为空 = 官方"简易式"（不改任何参数直接跑）。
 * 先 v2（Bearer），站点没有 v2 路由（1001）才退回 `/task/openapi/create`。
 */
export async function submitWorkflowTask(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: WorkflowEndpoint,
  input: {
    workflowId: string
    nodeInfoList?: { nodeId: string; fieldName: string; fieldValue: string }[]
    /** `default` 24G / `plus` 48G / `ultra` 84G（官方文档三档） */
    instanceType?: 'default' | 'plus' | 'ultra'
  },
  signal: AbortSignal,
): Promise<string> {
  const v2 = await submitV2Task(
    deps,
    endpoint,
    { kind: 'workflow', id: input.workflowId, nodeInfoList: input.nodeInfoList ?? [], ...(input.instanceType ? { instanceType: input.instanceType } : {}) },
    signal,
    SUBMIT_TIMEOUT_MS,
  )
  if ('taskId' in v2) return v2.taskId
  const body: Record<string, unknown> = {
    apiKey: endpoint.apiKey,
    workflowId: input.workflowId,
  }
  if (input.nodeInfoList && input.nodeInfoList.length > 0) body.nodeInfoList = input.nodeInfoList
  if (input.instanceType && input.instanceType !== 'default') body.instanceType = input.instanceType
  return submit(deps, endpoint, CREATE_PATH, body, signal, input.workflowId)
}

/**
 * `webappId` 该按什么类型发。
 *
 * ⚠️ 这是个**真坑**（2026-11-14 发现）：应用 id 是 19 位（如 `1877265245566922753`），
 * 超过 `Number.MAX_SAFE_INTEGER`（≈9.007e15）。`Number(id)` 之后 `JSON.stringify` 会变成
 * `1877265245566922800` —— **末几位被改掉**，要么报"应用不存在"，要么跑到别的应用上。
 * 官方示例里写的是数字字面量（那是文档作者的 JSON 文本，不是 JS 运行时），
 * 所以这里：**安全整数才发数字，否则发字符串**（服务端是 Java，数字串会被正常解析成 Long）。
 */
export function webappIdPayload(id: string): number | string {
  const text = String(id ?? '').trim()
  if (!/^\d+$/.test(text)) return text
  const asNumber = Number(text)
  return Number.isSafeInteger(asNumber) ? asNumber : text
}

/** 提交 AI 应用任务（同样先 v2，1001 才退回 `/task/openapi/ai-app/run`） */
export async function submitAppTask(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: WorkflowEndpoint,
  input: {
    webappId: string
    nodeInfoList: { nodeId: string; fieldName: string; fieldValue: string }[]
    instanceType?: 'default' | 'plus' | 'ultra'
  },
  signal: AbortSignal,
): Promise<string> {
  const v2 = await submitV2Task(
    deps,
    endpoint,
    { kind: 'app', id: input.webappId, nodeInfoList: input.nodeInfoList, ...(input.instanceType ? { instanceType: input.instanceType } : {}) },
    signal,
    SUBMIT_TIMEOUT_MS,
  )
  if ('taskId' in v2) return v2.taskId
  return submit(
    deps,
    endpoint,
    APP_RUN_PATH,
    {
      apiKey: endpoint.apiKey,
      webappId: webappIdPayload(input.webappId),
      nodeInfoList: input.nodeInfoList,
      ...(input.instanceType && input.instanceType !== 'default' ? { instanceType: input.instanceType } : {}),
    },
    signal,
    input.webappId,
  )
}

async function submit(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: WorkflowEndpoint,
  path: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  entryId: string,
): Promise<string> {
  const envelope = await postJson(deps, endpoint, path, body, signal, SUBMIT_TIMEOUT_MS)
  if (envelope.code !== 0) {
    throw new ChannelError({
      kind: 'http',
      status: 400,
      body: describeRhError(envelope as RhErrorEnvelope, `提交任务失败（${entryId}）`),
    })
  }
  const data = (envelope.data ?? {}) as { taskId?: string | number; promptTips?: unknown }
  const taskId = data.taskId === undefined || data.taskId === null ? '' : String(data.taskId)
  if (!taskId) {
    /**
     * 没有 taskId 但也没有错误码：`promptTips` 里通常写着哪个节点校验挂了
     * （官方示例里 `node_errors` 非空就是这个）。把原话带出去，别只说"失败了"。
     */
    const tips = typeof data.promptTips === 'string' ? data.promptTips : JSON.stringify(data.promptTips ?? '')
    throw new ChannelError({
      kind: 'http',
      status: 502,
      body: `RunningHub 已受理但没有返回 taskId${tips ? `：${tips.slice(0, 240)}` : ''}`,
    })
  }
  return taskId
}


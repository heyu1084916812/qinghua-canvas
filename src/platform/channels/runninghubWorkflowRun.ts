import { queryWorkflowTask, WORKFLOW_POLL_INTERVAL_MS, WORKFLOW_POLL_MAX_MS, type WorkflowEndpoint, type WorkflowTaskResult } from './runninghubWorkflow'
import type { PlatformKit } from '../ports'
import { ChannelError } from './types'
import { imageInputsOf, videoInputsOf } from '../../domain/shared/execution/inputs'
import type { NodeInput } from '../../domain/shared/execution/types'
import { UPSTREAM_MEDIA_VALUE } from '../../domain/project/workflowParamValues'
import { uploadWorkflowAsset } from './runninghubWorkflow'

/**
 * 工作流"跑起来"的那一段：参数三元组归一 + 提交之后的等待。
 *
 * 为什么单独一个文件：`runninghub.ts` 是超千行的改编排模块（模块治理钉在基线上），
 * `runninghubWorkflow.ts` 又贴着 450 行的新模块上限 —— 把这两个"与传输有关、
 * 与编排无关"的纯逻辑放这里，两边都不用顶预算。
 */

/**
 * 节点参数区下发的 `params.workflow` → `nodeInfoList`。
 *
 * 只认 `{nodeId, fieldName, fieldValue}` 三元组：上游（domain 的
 * `workflowNodeInfoList`）已经是这个形状，这里**再挡一次脏数据**——
 * 把 undefined / 对象值塞进提交体，服务端只会回一句看不懂的 1007。
 */
export function workflowNodeListOf(raw: unknown): {
  nodeId: string
  fieldName: string
  fieldValue: string
}[] {
  if (!Array.isArray(raw)) return []
  const out: { nodeId: string; fieldName: string; fieldValue: string }[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const nodeId = typeof record.nodeId === 'string' ? record.nodeId.trim() : ''
    const fieldName = typeof record.fieldName === 'string' ? record.fieldName.trim() : ''
    const fieldValue =
      typeof record.fieldValue === 'string'
        ? record.fieldValue
        : typeof record.fieldValue === 'number'
          ? String(record.fieldValue)
          : ''
    if (nodeId && fieldName) out.push({ nodeId, fieldName, fieldValue })
  }
  return out
}

/**
 * 把提交体里的「用上游素材」哨兵换成**上传后的文件名**（对账 #1104 媒体接线）。
 *
 * 顺序口径：先图片、后视频，按面板上的出现顺序各取一张；没有素材就**丢掉这一项**
 * （让工作流自己的默认值生效），不塞空串——空串在 RunningHub 是"清空该参数"。
 */
export async function resolveWorkflowMedia(
  deps: Pick<PlatformKit, 'network' | 'assets'>,
  endpoint: WorkflowEndpoint,
  list: { nodeId: string; fieldName: string; fieldValue: string }[],
  inputs: readonly NodeInput[],
  signal: AbortSignal,
): Promise<{ nodeId: string; fieldName: string; fieldValue: string }[]> {
  if (!list.some((item) => item.fieldValue === UPSTREAM_MEDIA_VALUE)) return list
  const refs = [...imageInputsOf([...inputs]), ...videoInputsOf([...inputs])]
  let index = 0
  const out: { nodeId: string; fieldName: string; fieldValue: string }[] = []
  for (const item of list) {
    if (item.fieldValue !== UPSTREAM_MEDIA_VALUE) {
      out.push(item)
      continue
    }
    const ref = refs[index]
    index += 1
    if (!ref) continue
    const payload = await deps.assets.read(ref.assetHash).catch(() => null)
    if (!payload || payload.bytes.length === 0) continue
    const fileName = await uploadWorkflowAsset(
      deps,
      endpoint,
      { bytes: payload.bytes, mime: payload.mime || ref.mime },
      ref.mime.startsWith('video/') ? 'ref.mp4' : 'ref.png',
      signal,
    )
    out.push({ ...item, fieldValue: fileName })
  }
  return out
}

export interface RunWorkflowOptions {
  signal: AbortSignal
  pollIntervalMs?: number
  pollTimeoutMs?: number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  now?: () => number
}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new ChannelError({ kind: 'network', detail: 'aborted' }))
      },
      { once: true },
    )
  })

/**
 * 提交之后**等结果**（工作流 / 应用共用同一套 V2 query）。
 *
 * 失败语义与适配器其它路径一致：**已提交之后的失败**统一是
 * `kind: 'execution', detail: 'accepted'` —— 钱可能已经花了，不能报成"没发出去"。
 */
export async function runWorkflowTask(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: WorkflowEndpoint,
  taskId: string,
  options: RunWorkflowOptions,
): Promise<string[]> {
  const { signal } = options
  const pollInterval = options.pollIntervalMs ?? WORKFLOW_POLL_INTERVAL_MS
  const pollTimeout = options.pollTimeoutMs ?? WORKFLOW_POLL_MAX_MS
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? (() => Date.now())
  const started = now()
  for (;;) {
    if (signal.aborted) throw new ChannelError({ kind: 'network', detail: 'aborted' })
    let task: WorkflowTaskResult | null = null
    try {
      task = await queryWorkflowTask(deps, endpoint, taskId, signal)
    } catch (e) {
      if (signal.aborted) throw e
      const appError = (e as { appError?: { kind?: string; status?: number } }).appError
      if (
        appError?.kind === 'http' &&
        appError.status !== undefined &&
        appError.status !== 408 &&
        appError.status !== 429 &&
        appError.status < 500
      ) {
        throw new ChannelError({
          kind: 'execution',
          detail: 'accepted',
          message: `RunningHub 任务 ${taskId} 已提交，但查询失败：${String((e as Error).message ?? e).slice(0, 200)}`,
        })
      }
      /* 网络抖动 / 5xx：继续等下一次轮询 */
    }
    if (task?.status === 'SUCCESS') {
      if (task.urls.length === 0) {
        throw new ChannelError({
          kind: 'parse',
          raw: '工作流任务成功但没有返回产物（上游只回了空 results）',
        })
      }
      return task.urls
    }
    if (task?.status === 'FAILED') {
      const detail = task.errorMessage || '任务失败'
      const code = task.errorCode ? `（${task.errorCode}）` : ''
      throw new ChannelError({
        kind: 'execution',
        detail: 'accepted',
        message: `RunningHub 工作流 ${taskId} 已提交但失败：${detail}${code}`,
      })
    }
    if (now() - started + pollInterval >= pollTimeout) {
      throw new ChannelError({
        kind: 'execution',
        detail: 'accepted',
        message: `RunningHub 工作流 ${taskId} 已提交，但轮询超时或结果未知`,
      })
    }
    await sleep(pollInterval, signal)
  }
}

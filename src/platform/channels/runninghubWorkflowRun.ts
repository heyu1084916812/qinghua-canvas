import { queryWorkflowTask, WORKFLOW_POLL_INTERVAL_MS, WORKFLOW_POLL_MAX_MS, type WorkflowEndpoint, type WorkflowTaskResult } from './runninghubWorkflow'
import type { PlatformKit } from '../ports'
import { ChannelError } from './types'
import { asAppError, errorTextOf } from '../../shared/result'
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
 * AI 应用的节点参数：**默认值 + 面板暴露字段**一次填好（对账 #1107）。
 *
 * 三层的顺序是刻意的：
 * ① 先按字段名填「提示词」与应用最常用的三档（老路径；一个字段都没暴露时靠它）；
 * ② 再把面板下发的 `nodeInfoList` 按 `nodeId + fieldName` **精确覆盖** —— 应用作者起的
 *    字段名千奇百怪，按名字猜只能碰上几个，按 id 覆盖才是准的；
 * ③ 没传的项**一个都不动**（保持应用自己的默认值），不塞空串（空串在 RunningHub 是
 *    「清空该参数」，不是「用默认」）。
 */
export function fillAppNodeValues(
  nodes: { nodeId?: unknown; fieldName?: unknown; fieldType?: unknown; fieldValue?: unknown }[],
  prompt: string,
  params?: Record<string, unknown>,
): void {
  const setField = (fieldName: string, value: unknown) => {
    const target = nodes.find((node) => node.fieldType === fieldName || node.fieldName === fieldName)
    if (target) target.fieldValue = value
  }
  setField('prompt', prompt)
  const putField = (fieldName: string, raw: unknown) => {
    const value = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : ''
    if (value !== '') setField(fieldName, value)
  }
  putField('aspectRatio', params?.ratio)
  putField('resolution', params?.resolution)
  putField('duration', params?.duration)

  for (const item of workflowNodeListOf(params?.workflow)) {
    const target = nodes.find(
      (node) => String(node.nodeId) === item.nodeId && String(node.fieldName) === item.fieldName,
    )
    if (target) target.fieldValue = item.fieldValue
  }
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

/** `params.instanceType` → 提交体字段（只认官方三档；`default` 不发） */
export function instanceTypeOf(params: Record<string, unknown> | undefined): { instanceType?: 'plus' | 'ultra' } {
  const raw = params?.instanceType
  return raw === 'plus' || raw === 'ultra' ? { instanceType: raw } : {}
}

export interface RunWorkflowOptions {
  signal: AbortSignal
  pollIntervalMs?: number
  pollTimeoutMs?: number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  now?: () => number
}

/** 正常醒来要摘掉 abort 监听（20 分钟能攒 240 个，#1126 L3）；已取消的 signal 立刻拒绝，不白睡一轮 */
const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ChannelError({ kind: 'network', detail: 'aborted' }))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new ChannelError({ kind: 'network', detail: 'aborted' }))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
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
      /**
       * `fetchNetwork` 对非 2xx 抛的是**普通 AppError 对象**（不是 ChannelError），
       * 只读 `.appError` 会把 401/403/404 当成抖动、白等 20 分钟（#1126 M5）。
       */
      const appError = asAppError(e)
      if (
        appError?.kind === 'http' &&
        appError.status !== 408 &&
        appError.status !== 429 &&
        appError.status < 500
      ) {
        throw new ChannelError({
          kind: 'execution',
          detail: 'accepted',
          message: `RunningHub 任务 ${taskId} 已提交，但查询失败：${errorTextOf(e).slice(0, 200)}`,
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
    /**
     * v2 query 以 HTTP 200 + 顶层 `errorCode` 报错（真机 `1004 Task not found`），`status` 为空。
     * 不认它就当"还在跑"，同样要白等 20 分钟（#1126 M5）。
     */
    if (task && task.status === 'UNKNOWN' && task.errorCode && task.errorCode !== '0') {
      throw new ChannelError({
        kind: 'execution',
        detail: 'accepted',
        message: `RunningHub 任务 ${taskId} 已提交，但查询报错：${task.errorMessage || '未知错误'}（${task.errorCode}）`,
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

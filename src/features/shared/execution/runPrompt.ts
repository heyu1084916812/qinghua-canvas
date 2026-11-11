import type { RunTask } from '../../../domain/shared/execution/plan'
import type { RunRequest } from '../../../domain/shared/execution/types'

type PromptTask = Pick<RunTask, 'seq' | 'collectionItemId'>

/**
 * 渠道请求的最终 prompt 修饰。
 *
 * 同一来源展开成多次调用时，渠道常把 `(model, prompt)` 当缓存键；没有差异
 * 会退化成一张图。这个后缀是执行事实的一部分，所以日志、节点展示和渠道请求
 * 必须走同一个函数，不能各自再拼一遍。
 */
export function applyCallOrdinal<T extends RunRequest>(
  task: PromptTask,
  request: T,
): T {
  const seq = task.seq ?? 0
  if (seq <= 0) return request
  const mark = task.collectionItemId ? `第 ${seq + 1} 项` : `第 ${seq + 1} 次`
  return { ...request, prompt: `${request.prompt}（${mark}）` }
}

export function actualPromptOf(task: PromptTask, request: RunRequest): string {
  return applyCallOrdinal(task, request).prompt
}

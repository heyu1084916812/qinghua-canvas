import type { PlatformKit, StoragePort } from '../platform/ports'
import { backfillAssetThumbs } from '../platform/assetThumb'

/**
 * **存量素材一次性补图的去重控制器**（对账 #966）：非画布页每次挂载 / StrictMode
 * 重挂载都会跑一遍 `presets` 标记读取，这里按同一 `StoragePort` 复用进行中的
 * 标记读取与补图 Promise，并在成功写入标记后的本会话内直接跳过重复查询。
 *
 * 生命周期约定：
 * - 每个订阅者（组件挂载）拿到自己的 `AbortSignal`；引用计数归零才真正中断补图，
 *   一个订阅者卸载不会弄丢另一个仍活跃订阅者的成功结果。
 * - 补图被中断 / 失败时不写标记，状态立即释放，下一次挂载可重试。
 * - 补图成功并写入 `job:assetThumbBackfill` 后，本会话内后续挂载不再重复读标记。
 */
export const THUMB_BACKFILL_MARKER_ID = 'job:assetThumbBackfill'

export interface ThumbBackfillSubscription {
  /** 供订阅者判断自身是否已被取消（卸载 / 进入画布）。 */
  readonly signal: AbortSignal
  /** 订阅者退出时调用：是否中断共享补图取决于是否还有其他活跃订阅者。 */
  release(): void
}

interface BackfillState {
  /** 本 session 已确认标记存在（或刚由我们写入），之后直接跳过。 */
  done: boolean
  subscribers: number
  controller: AbortController | null
  pending: Promise<void> | null
}

const states = new WeakMap<StoragePort, BackfillState>()

function stateFor(storage: StoragePort): BackfillState {
  let state = states.get(storage)
  if (!state) {
    state = { done: false, subscribers: 0, controller: null, pending: null }
    states.set(storage, state)
  }
  return state
}

async function runBackfill(platform: PlatformKit, state: BackfillState): Promise<void> {
  const signal = state.controller?.signal
  try {
    const marked = await platform.storage.query('presets', { id: THUMB_BACKFILL_MARKER_ID })
    if (signal?.aborted) return
    if (marked[0]) {
      state.done = true
      return
    }
    const result = await backfillAssetThumbs(platform, { signal })
    if (signal?.aborted || result.aborted) return
    await platform.storage.put('presets', {
      id: THUMB_BACKFILL_MARKER_ID,
      version: 1,
      doneAt: Date.now(),
    })
    state.done = true
    platform.logger.log('info', '[assetThumb] 存量素材缩略图补完', {
      scanned: result.scanned,
      generated: result.generated,
    })
  } catch (err) {
    // 补图失败不该打扰任何人：缩略图是优化，界面照旧用原图
    platform.logger.log('warn', '[assetThumb] 补图未完成', { error: String(err) })
  } finally {
    state.pending = null
    state.controller = null
  }
}

/**
 * 订阅一次性补图。若本 session 已确认完成，返回一个立即可释放的订阅且
 * 不再触碰存储；否则复用 / 启动共享补图。
 */
export function subscribeThumbBackfill(platform: PlatformKit): ThumbBackfillSubscription {
  const state = stateFor(platform.storage)
  state.subscribers += 1

  const sub = new AbortController()
  let released = false

  if (!state.done && !state.pending) {
    state.controller = new AbortController()
    state.pending = runBackfill(platform, state)
  }

  return {
    signal: sub.signal,
    release() {
      if (released) return
      released = true
      sub.abort()
      state.subscribers -= 1
      if (state.subscribers <= 0) {
        // 没有任何订阅者还在乎结果了：中断共享补图，且没跑完不写标记。
        // 延迟到微任务：StrictMode 的「卸载→立刻重挂载」在同一同步块里完成，
        // 等新订阅者入列后再判断，避免把正要复用的进行中补图误杀。
        state.subscribers = 0
        const controller = state.controller
        queueMicrotask(() => {
          if (state.subscribers === 0) controller?.abort()
        })
      }
    },
  }
}

/** 仅测试用：清空去重状态，模拟全新会话。 */
export function resetThumbBackfillForTest(storage: StoragePort): void {
  states.delete(storage)
}

import type { PinterestBoard, PinterestPin } from '../../../domain/inspiration/pinterest'
import type { DesignResearchItem } from '../../../domain/inspiration/designResearch'
import { pinterestPinToResearchItem } from '../../../domain/inspiration/pinterest'
import type { LibraryAsset } from '../../../domain/shared/assetLibrary'
import type { PlatformKit } from '../../../platform/ports'
import { errorTextOf } from '../../../shared/result'
import { saveDesignResearchItem } from '../research/saveResearchItem'
import { sendAssetToActiveCanvas } from '../../assets/sendToActiveCanvas'
import type { PinterestPageResult } from './pinterestApi'

export interface PinterestPinLoadOutcome {
  board: PinterestBoard
  outcome: PromiseSettledResult<PinterestPageResult<PinterestPin>>
}

export interface PinterestPinLoadFailure {
  boardId: string
  boardName: string
  reason: string
}

export interface PinterestPinLoadSummary {
  items: PinterestPin[]
  truncated: boolean
  pageCount: number
  failures: PinterestPinLoadFailure[]
}

export function summarizePinterestPinLoads(
  inputs: PinterestPinLoadOutcome[],
): PinterestPinLoadSummary {
  const items: PinterestPin[] = []
  const failures: PinterestPinLoadFailure[] = []
  let truncated = false
  let pageCount = 0
  for (const { board, outcome } of inputs) {
    if (outcome.status === 'rejected') {
      failures.push({
        boardId: board.id,
        boardName: board.name,
        reason: errorTextOf(outcome.reason),
      })
      continue
    }
    items.push(...outcome.value.items)
    truncated = truncated || outcome.value.truncated
    pageCount = Math.max(pageCount, outcome.value.pageCount)
  }
  return { items, truncated, pageCount, failures }
}

export interface PinterestImportTarget {
  pin: PinterestPin
  board: PinterestBoard
  item: DesignResearchItem
}

export interface PinterestImportSkip {
  pinId: string
  title: string
  reason: string
}

export function resolvePinterestImportTargets(
  pins: PinterestPin[],
  selectedPinIds: ReadonlySet<string>,
  boards: readonly PinterestBoard[],
): {
  targets: PinterestImportTarget[]
  skipped: PinterestImportSkip[]
} {
  const targets: PinterestImportTarget[] = []
  const skipped: PinterestImportSkip[] = []
  for (const pin of pins) {
    if (!selectedPinIds.has(pin.id) || !pin.imageUrl) continue
    const board = boards.find((item) => item.id === pin.boardId)
    if (!board) {
      skipped.push({
        pinId: pin.id,
        title: pin.title,
        reason: `找不到收藏板 ${pin.boardId}`,
      })
      continue
    }
    const item = pinterestPinToResearchItem(pin, board)
    if (!item) {
      skipped.push({
        pinId: pin.id,
        title: pin.title,
        reason: '缺少可导入的图片信息',
      })
      continue
    }
    targets.push({ pin, board, item })
  }
  return { targets, skipped }
}

export interface PinterestImportResult {
  pinId: string
  title: string
  ok: boolean
  reason?: string
  asset?: LibraryAsset
}

export interface PinterestImportSummary {
  succeeded: PinterestImportResult[]
  failed: PinterestImportResult[]
}

export function summarizePinterestImportResults(
  results: PinterestImportResult[],
  skipped: PinterestImportSkip[],
  canceled = false,
): PinterestImportSummary {
  const succeeded = results.filter((result) => result.ok)
  const failed = [
    ...results.filter((result) => !result.ok).map((result) => ({
      ...result,
      reason: result.reason ?? '导入失败',
    })),
    ...(canceled
      ? []
      : skipped.map((item) => ({
          pinId: item.pinId,
          title: item.title,
          ok: false,
          reason: item.reason,
        }))),
  ]
  return { succeeded, failed }
}

export async function runPinterestImports(input: {
  targets: readonly PinterestImportTarget[]
  toCanvas: boolean
  platform: PlatformKit
  signal: AbortSignal
  onProgress?: (done: number, total: number) => void
}): Promise<{ results: PinterestImportResult[]; canceled: boolean }> {
  const results: PinterestImportResult[] = []
  for (const pin of input.targets) {
    if (input.signal.aborted) break
    let result: PinterestImportResult
    try {
      const saved = await saveDesignResearchItem(
        pin.item,
        { network: input.platform.network, storage: input.platform.storage },
        input.signal,
      )
      if (!saved.ok || !saved.asset) {
        result = {
          pinId: pin.pin.id,
          title: pin.pin.title,
          ok: false,
          reason: saved.message,
        }
      } else {
        if (input.toCanvas) {
          await sendAssetToActiveCanvas(input.platform, saved.asset)
        }
        result = {
          pinId: pin.pin.id,
          title: pin.pin.title,
          ok: true,
          asset: saved.asset,
        }
      }
    } catch (cause) {
      if (input.signal.aborted) break
      result = {
        pinId: pin.pin.id,
        title: pin.pin.title,
        ok: false,
        reason: errorTextOf(cause),
      }
    }
    results.push(result)
    input.onProgress?.(results.length, input.targets.length)
  }
  return { results, canceled: input.signal.aborted }
}

export function pinterestBoardStatus(page: PinterestPageResult<PinterestBoard>): string {
  return page.truncated
    ? `读取到前 ${page.items.length} 个收藏板；已达 ${page.pageCount} 页安全上限，还有更多未读取。`
    : `读取到 ${page.items.length} 个收藏板。`
}

export function pinterestPinStatus(summary: PinterestPinLoadSummary): string {
  const failureText = summary.failures.length
    ? ` ${summary.failures.length} 个收藏板读取失败：${summary.failures
        .map((item) => `${item.boardName}（${item.reason}）`)
        .join('；')}`
    : ''
  const truncatedText = summary.truncated
    ? ` 部分收藏板已到 ${summary.pageCount} 页安全上限，仍有未读取内容。`
    : ''
  return `读取到 ${summary.items.length} 张收藏图片。${truncatedText}${failureText}`
}

export function pinterestImportStatus(
  summary: PinterestImportSummary,
  toCanvas: boolean,
  canceled = false,
): string {
  const reasonText = summary.failed.length
    ? ` 失败原因：${summary.failed
        .map((item) => `${item.title}（${item.reason}）`)
        .join('；')}`
    : ''
  const prefix = canceled ? '导入已停止；' : ''
  return prefix + (toCanvas
    ? `已导入 ${summary.succeeded.length} 张到当前画布，失败 ${summary.failed.length} 张。${reasonText}`
    : `已保存 ${summary.succeeded.length} 张到素材库，失败 ${summary.failed.length} 张。${reasonText}`)
}

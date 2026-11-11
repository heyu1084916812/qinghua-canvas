import type { NodeInput } from '../../../../domain/shared/execution/types'
import type {
  ReferenceAssetRef,
  ReferenceItem,
  ReferenceUsage,
} from '../../../../domain/project/referenceLedger'
import {
  REFERENCE_CURATION_SYSTEM_PROMPT,
  buildReferenceCurationPrompt,
  parseReferenceCurationText,
  referenceUsageId,
  type ReferenceCurationResult,
} from '../../../../domain/project/referenceCuration'
import { isAutoReferenceTitle } from '../../../../domain/project/referenceTitle'
import {
  paletteSentence,
  type PaletteColor,
} from '../../../../domain/project/referencePalette'
import { sampleImagePalette } from './agentReferencePalette'
import { imageSizeFromHeader } from '../../../../domain/shared/imageSize'
import type { PlatformKit } from '../../../../platform/ports'
import type { RouteExecutionPort } from '../../../../features/shared/agent/RouteExecutionPort'
import { createReferenceLedgerRepository } from '../../../../state/project/referenceLedgerRepository'
import { directTextTrace } from '../../../../state/shared/directRun'
import { errText } from '../../agent/agentLoop'
import type { AgentChatRoute } from './agentChatRoute'
import { imageContextAssets } from './agentToolContextAssets'

const MAX_ITEMS_PER_CALL = 12
const MAX_IMAGES_PER_ITEM = 8

export interface AgentReferenceCurationDeps {
  storage: PlatformKit['storage']
  assets: Pick<PlatformKit['assets'], 'read'>
  routeExecution: RouteExecutionPort
  onRecordWarning(warning: string): void
  /** C3：本地像素采样主色；缺省用浏览器解码，测试可注入。 */
  samplePalette?(bytes: Uint8Array, mime: string): Promise<PaletteColor[] | null>
}

export interface AgentReferenceCurationInput {
  projectId: string
  sessionId: string
  operationId: string
  taskKey: string
  task: string
  route: AgentChatRoute | null
  preferredItemIds?: readonly string[]
  requestedItemIds?: readonly string[]
  signal?: AbortSignal
}

export async function runAgentReferenceCuration(
  deps: AgentReferenceCurationDeps,
  input: AgentReferenceCurationInput,
): Promise<ReferenceCurationResult> {
  if (!input.route) {
    return emptyResult(input.taskKey, '当前回合没有可用于参考分析的对话模型路由')
  }
  const repository = createReferenceLedgerRepository(deps.storage)
  const projectId = input.projectId
  const [items, existingUsages] = await Promise.all([
    repository.listItems(projectId),
    repository.listUsages(projectId, input.taskKey),
  ])
  const requested = new Set(
    [...(input.requestedItemIds ?? []), ...(input.preferredItemIds ?? [])]
      .filter(Boolean),
  )
  const usageByItem = new Map(existingUsages.map((usage) => [usage.itemId, usage]))
  const allCandidates = requested.size > 0
    ? items.filter((item) => requested.has(item.id))
    : items
  const reanalyze = (input.requestedItemIds?.length ?? 0) > 0
  const candidates = allCandidates
    .filter((item) => reanalyze || !usageByItem.has(item.id))
    .slice(0, MAX_ITEMS_PER_CALL)
  const limitations: string[] = []
  if (allCandidates.length > candidates.length) {
    limitations.push(
      `本次只分析前 ${candidates.length} 条参考，另有 ${
        allCandidates.length - candidates.length
      } 条可在下一次继续分析。`,
    )
  }
  if (candidates.length === 0) {
    return {
      ok: true,
      summary: '当前任务的参考分析已是最新',
      taskKey: input.taskKey,
      analyzed: [],
      failed: [],
      limitations,
    }
  }

  const analyzed: ReferenceCurationResult['analyzed'] = []
  const failed: ReferenceCurationResult['failed'] = []
  for (const item of candidates) {
    if (input.signal?.aborted) break
    const prepared = await prepareItemImages(
      item,
      deps.assets,
      deps.samplePalette ?? ((bytes, mime) => sampleImagePalette(bytes, mime)),
    )
    limitations.push(
      ...prepared.limitations.map((reason) => `「${item.title}」${reason}`),
    )
    const prompt = buildReferenceCurationPrompt({
      item,
      task: input.task,
      imageLabels: prepared.labels,
    })
    try {
      const result = await deps.routeExecution.execute({
        channelId: input.route.channelId,
        model: input.route.upstreamModel,
        modelIsUpstream: true,
        tools: [],
        messages: [
          { role: 'system', content: REFERENCE_CURATION_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        inputs: prepared.inputs,
        signal: input.signal ?? new AbortController().signal,
        routeCandidates: input.route.candidates,
        routePlanId: input.route.routePlanId,
        trace: directTextTrace({
          projectId,
          workbench: 'canvas',
          subjectId: input.sessionId,
          scopeId: `session:${input.sessionId}`,
          operationId: input.operationId,
          purpose: 'agent-reference-curation',
          channelId: input.route.channelId,
          model: input.route.upstreamModel,
          prompt,
          inputs: prepared.inputs,
          params: {
            taskKey: input.taskKey,
            itemId: item.id,
            imageCount: prepared.inputs.length,
          },
        }),
        onRecordWarning: deps.onRecordWarning,
      })
      const parsed = parseReferenceCurationText(result.text)
      if (!parsed.ok) {
        failed.push({
          itemId: item.id,
          title: item.title,
          reason: parsed.reason,
        })
        continue
      }
      const now = Date.now()
      // C3：颜色给本地采样的真实色值，不让模型猜 HEX。
      const palette = paletteSentence(prepared.palette)
      const whatWithPalette = palette
        ? `${parsed.analysis.what.replace(/[。.]?\s*$/, '')}。${palette}。`
        : parsed.analysis.what
      // C1：文件名式标题换成分析给出的语义短名；用户自己起的标题不动。
      const title = parsed.analysis.title && isAutoReferenceTitle(item.title)
        ? parsed.analysis.title
        : item.title
      const nextItem: ReferenceItem = {
        ...item,
        title,
        what: whatWithPalette,
        updatedAt: now,
      }
      const usage: ReferenceUsage = {
        id: referenceUsageId({
          projectId,
          taskKey: input.taskKey,
          itemId: item.id,
        }),
        itemId: item.id,
        projectId,
        taskKey: input.taskKey,
        usage: parsed.analysis.usage,
        howToUse: parsed.analysis.howToUse,
        ...(parsed.analysis.identityAnchor ? { identityAnchor: true } : {}),
        createdAt: usageByItem.get(item.id)?.createdAt ?? now,
        updatedAt: now,
      }
      await repository.putItem(nextItem)
      await repository.putUsage(usage)
      analyzed.push({
        itemId: item.id,
        title,
        what: whatWithPalette,
        usage: parsed.analysis.usage,
        howToUse: parsed.analysis.howToUse,
      })
      limitations.push(
        ...parsed.analysis.limitations.map(
          (reason) => `「${item.title}」${reason}`,
        ),
      )
    } catch (error) {
      failed.push({
        itemId: item.id,
        title: item.title,
        reason: errText(error),
      })
    }
  }

  if (input.signal?.aborted) {
    limitations.push('参考分析被用户停止；已完成的结果已保存。')
  }
  return {
    ok: analyzed.length > 0 && failed.length === 0,
    summary: [
      `分析了 ${analyzed.length} 条参考`,
      failed.length > 0 ? `${failed.length} 条失败` : '',
    ].filter(Boolean).join('，'),
    taskKey: input.taskKey,
    analyzed,
    failed,
    limitations,
  }
}

async function prepareItemImages(
  item: ReferenceItem,
  assets: AgentReferenceCurationDeps['assets'],
  samplePalette: NonNullable<AgentReferenceCurationDeps['samplePalette']>,
): Promise<{
  inputs: NodeInput[]
  labels: string[]
  limitations: string[]
  palette: PaletteColor[]
}> {
  const refs = item.assets?.length
    ? item.assets
    : item.assetHash
      ? [{
          hash: item.assetHash,
          role: 'reference' as const,
          name: item.title,
        }]
      : []
  const inputs: NodeInput[] = []
  const labels: string[] = []
  const limitations: string[] = []
  let palette: PaletteColor[] = []
  const seen = new Set<string>()
  for (const [index, ref] of refs.entries()) {
    if (inputs.length >= MAX_IMAGES_PER_ITEM) {
      limitations.push(`只提交前 ${MAX_IMAGES_PER_ITEM} 张图片`)
      break
    }
    if (!ref.hash || seen.has(ref.hash)) continue
    seen.add(ref.hash)
    const payload = await assets.read(ref.hash).catch(() => null)
    if (!payload?.bytes.length) {
      limitations.push(`${assetLabel(ref, index)} 的图片字节不可读，已跳过`)
      continue
    }
    if (imageContextAssets([{ mime: payload.mime }]).length === 0) {
      limitations.push(`${assetLabel(ref, index)} 不是图片，已跳过`)
      continue
    }
    const size = imageSizeFromHeader(payload.bytes)
    inputs.push({
      kind: 'asset',
      nodeId: `reference:${item.id}:${index}`,
      assetHash: ref.hash,
      mime: payload.mime,
      ...(size && size.width > 0 && size.height > 0
        ? { naturalSize: size }
        : {}),
    })
    labels.push(assetLabel(ref, index))
    // 只采第一张可读的非 Logo 图（套件里 Logo 的颜色另有规范）；单图卡就是它本身。
    if (palette.length === 0 && (ref.role !== 'logo' || refs.length === 1)) {
      palette = (await samplePalette(payload.bytes, payload.mime).catch(() => null)) ?? []
    }
  }
  return { inputs, labels, limitations, palette }
}

function assetLabel(asset: ReferenceAssetRef, index: number): string {
  const name = asset.name.trim()
  return `${asset.role === 'logo' ? 'Logo' : `参考图 ${index + 1}`}${
    name ? `「${name}」` : ''
  }`
}

function emptyResult(
  taskKey: string,
  reason: string,
): ReferenceCurationResult {
  return {
    ok: false,
    summary: reason,
    taskKey,
    analyzed: [],
    failed: [],
    limitations: [reason],
  }
}

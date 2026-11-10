import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
import type { Viewport } from '../../../../domain/canvas/geometry/coords'
import type { PlatformKit } from '../../../../platform/ports'
import type { AssetLibraryStore } from '../../../../state/project/assetLibraryStore'
import { assetNodeSize } from '../../../../domain/canvas/layout/assetNodeSize'
import {
  centeredNodeOrigin,
  findFreeRect,
} from '../../../../domain/agent/landing'
import {
  createAssetNode,
  importAssetFile,
  isImportableMedia,
  type ImportedAsset,
} from '../../../../features/canvas/importAsset'
import {
  subscribeAgentHandoff,
  subscribeReferenceAgentHandoff,
  takeAgentHandoff,
  takeReferenceAgentHandoff,
  type AgentReferenceHandoff,
} from '../../../../features/canvas/agentHandoff'
import { loadAssetUrl } from '../../../../features/shared/assets/index'
import { createReferenceLedgerRepository } from '../../../../state/project/referenceLedgerRepository'
import type { TaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'
import { parseMentions } from '../../text/MentionEditor'
import { viewportWorldOf } from './agentPanelViewHelpers'

export interface AgentAttachmentsControllerInput {
  active: boolean
  projectId: string
  current: AgentSession | null
  draft: string
  messages: readonly ChatMessage[]
  nodeHashes: ReadonlyMap<string, string>
  platform: PlatformKit
  store: CanvasStore
  viewport: Viewport
  library: AssetLibraryStore
  insertMention: (
    kind: 'node' | 'model' | 'skill' | 'reference',
    id: string,
    label: string,
  ) => void
  nodeLabelOf: (nodeId: string) => string
  /**
   * 追加待发送附件（store 侧原子读改写，见 `sessionStore.appendPendingAssetIds`）。
   *
   * 投递路径**不许**再用「渲染快照 `current.pendingAssetIds` + 整字段写回」：
   * 两次快速投递会基于同一份旧基线互相覆盖（#919 P3），而控制器里本地 rebase
   * 又会复活用户刚删掉的 id（这个字段还有别的写者）。
   */
  appendPendingAssetIds: (
    sessionId: string,
    assetIds: readonly string[],
  ) => Promise<AgentSession | null>
  /** 同上，但脱离点击等待链（画布 handoff 是同步入口） */
  appendPendingAssetIdsDetached: (
    sessionId: string,
    assetIds: readonly string[],
  ) => void
  appendReferenceIds: (
    sessionId: string,
    referenceIds: readonly string[],
  ) => Promise<AgentSession | null>
  /** 把追加后的会话回灌到面板（`list` 与 `current` 都跟着更新） */
  applySessionSnapshot: (session: AgentSession) => void
  trackRun: TaskLifecycle['track']
}

export interface AgentAttachmentsController {
  addFromLibrary: (hash: string) => Promise<void>
  attachFiles: (files: FileList | null) => Promise<void>
  thumbOf: (id: string) => string | null
  thumbVersion: number
}

/**
 * Agent 附件与素材投递的 React 适配：本地文件、素材库、画布选中 handoff 与引用缩略图。
 * 节点仍落在 CanvasStore，附件仍写 AgentSession；这里不发送消息、不请求模型、不改 Job。
 */
export function useAgentAttachmentsController(
  input: AgentAttachmentsControllerInput,
): AgentAttachmentsController {
  const handoffRef = useRef<string[]>([])
  const referenceHandoffRef = useRef<AgentReferenceHandoff[]>([])

  const flushHandoff = useCallback(() => {
    if (!input.current || handoffRef.current.length === 0) return
    const existing = new Set(
      input.store.getSnapshot().nodes.map((node) => node.id),
    )
    const picked = handoffRef.current.filter((id) => existing.has(id))
    handoffRef.current = []
    if (picked.length === 0) return
    for (const id of picked) {
      input.insertMention('node', id, input.nodeLabelOf(id))
    }
    input.appendPendingAssetIdsDetached(input.current.id, picked)
  }, [
    input.current,
    input.insertMention,
    input.nodeLabelOf,
    input.appendPendingAssetIdsDetached,
    input.store,
  ])

  useEffect(() => {
    if (!input.active) return
    const queue = (ids: readonly string[]) => {
      handoffRef.current = [
        ...new Set([...handoffRef.current, ...ids]),
      ]
      flushHandoff()
    }
    queue(takeAgentHandoff(input.projectId))
    return subscribeAgentHandoff(input.projectId, queue)
  }, [flushHandoff, input.active, input.projectId])

  const flushReferenceHandoff = useCallback(() => {
    if (!input.current || referenceHandoffRef.current.length === 0) return
    const refs = [...referenceHandoffRef.current]
    referenceHandoffRef.current = []
    for (const ref of refs) {
      input.insertMention('reference', ref.id, ref.label)
    }
    void input
      .appendReferenceIds(
        input.current.id,
        refs.map((ref) => ref.id),
      )
      .then((next) => {
        if (next) input.applySessionSnapshot(next)
      })
      .catch(() => null)
  }, [
    input.appendReferenceIds,
    input.applySessionSnapshot,
    input.current,
    input.insertMention,
  ])

  useEffect(() => {
    if (!input.active) return
    const queue = (refs: readonly AgentReferenceHandoff[]) => {
      const byId = new Map(
        referenceHandoffRef.current.map((ref) => [ref.id, ref]),
      )
      for (const ref of refs) byId.set(ref.id, ref)
      referenceHandoffRef.current = [...byId.values()]
      flushReferenceHandoff()
    }
    queue(takeReferenceAgentHandoff(input.projectId))
    return subscribeReferenceAgentHandoff(input.projectId, queue)
  }, [flushReferenceHandoff, input.active, input.projectId])

  const placeAsset = useCallback(
    (asset: ImportedAsset): string | null => {
      const size = assetNodeSize({
        width: asset.width,
        height: asset.height,
      })
      const existing = input.store
        .getSnapshot()
        .nodes.map((node) => ({
          x: node.x,
          y: node.y,
          w: node.w,
          h: node.h,
        }))
      const centered = centeredNodeOrigin(
        size,
        viewportWorldOf(input.viewport),
      )
      const spot = findFreeRect({ ...size, ...centered }, existing)
      return createAssetNode(
        {
          platform: input.platform,
          store: input.store,
          projectId: input.projectId,
        },
        asset,
        { x: spot.x, y: spot.y },
      )
    },
    [input.platform, input.projectId, input.store, input.viewport],
  )

  const addFromLibrary = useCallback(
    (hash: string) =>
      input.trackRun(async () => {
        const asset = input.library
          .getState()
          .assets.find((candidate) => candidate.hash === hash)
        if (!input.current || !asset) return
        const id = placeAsset({
          hash: asset.hash,
          mime: asset.mime,
          width: asset.width,
          height: asset.height,
        })
        if (!id) return
        input.insertMention('node', id, input.nodeLabelOf(id))
        const next = await input.appendPendingAssetIds(input.current.id, [id])
        if (next) input.applySessionSnapshot(next)
      }),
    [
      input.current,
      input.insertMention,
      input.library,
      input.nodeLabelOf,
      input.appendPendingAssetIds,
      input.applySessionSnapshot,
      input.trackRun,
      placeAsset,
    ],
  )

  const attachFiles = useCallback(
    (files: FileList | null) =>
      input.trackRun(async () => {
        if (!files || files.length === 0 || !input.current) return
        const deps = {
          platform: input.platform,
          store: input.store,
          projectId: input.projectId,
        }
        const added: string[] = []
        for (const file of Array.from(files)) {
          if (!isImportableMedia(file.type)) continue
          const asset = await importAssetFile(deps, file)
          if (!asset) continue
          const id = placeAsset(asset)
          if (id) added.push(id)
        }
        if (added.length === 0) return
        for (const id of added) {
          input.insertMention('node', id, input.nodeLabelOf(id))
        }
        const next = await input.appendPendingAssetIds(input.current.id, added)
        if (next) input.applySessionSnapshot(next)
      }),
    [
      input.current,
      input.insertMention,
      input.nodeLabelOf,
      input.appendPendingAssetIds,
      input.applySessionSnapshot,
      input.platform,
      input.projectId,
      input.store,
      input.trackRun,
      placeAsset,
    ],
  )

  const thumbCacheRef = useRef(new Map<string, string>())
  const referenceThumbCacheRef = useRef(new Map<string, string>())
  const [thumbVersion, setThumbVersion] = useState(0)
  const thumbOf = useCallback(
    (id: string) =>
      thumbCacheRef.current.get(id) ??
      referenceThumbCacheRef.current.get(id) ??
      null,
    [],
  )

  useEffect(() => {
    const nodeRefs = [
      ...parseMentions(input.draft).filter(
        (mention) => mention.kind === 'node',
      ),
      ...(input.current?.pendingAssetIds ?? []).map((id) => ({
        kind: 'node' as const,
        id,
      })),
      ...input.messages.flatMap((message) =>
        parseMentions(message.display ?? message.content).filter(
          (mention) => mention.kind === 'node',
        ),
      ),
    ]
    const referenceIds = [
      ...parseMentions(input.draft)
        .filter((mention) => mention.kind === 'reference')
        .map((mention) => mention.id),
      ...(input.current?.referenceIds ?? []),
      ...input.messages.flatMap((message) =>
        parseMentions(message.display ?? message.content)
          .filter((mention) => mention.kind === 'reference')
          .map((mention) => mention.id),
      ),
    ]
    if (nodeRefs.length === 0 && referenceIds.length === 0) return
    let alive = true
    void (async () => {
      let added = false
      for (const ref of nodeRefs) {
        if (thumbCacheRef.current.has(ref.id)) continue
        const hash = input.nodeHashes.get(ref.id)
        if (!hash) continue
        const meta = await loadAssetUrl(input.platform, hash)
        if (!alive || !meta.url) continue
        thumbCacheRef.current.set(ref.id, meta.url)
        added = true
      }
      const missingReferenceIds = [
        ...new Set(referenceIds),
      ].filter((id) => !referenceThumbCacheRef.current.has(id))
      if (missingReferenceIds.length > 0) {
        const repository = createReferenceLedgerRepository(input.platform.storage)
        const items = await repository.listItems(input.projectId)
        const byId = new Map(items.map((item) => [item.id, item]))
        for (const id of missingReferenceIds) {
          const item = byId.get(id)
          if (item?.kind !== 'image') continue
          const hash = item?.assetHash ?? item?.assets?.[0]?.hash
          if (!hash) continue
          const meta = await loadAssetUrl(input.platform, hash)
          if (!alive || !meta.url) continue
          referenceThumbCacheRef.current.set(id, meta.url)
          added = true
        }
      }
      if (added && alive) setThumbVersion((version) => version + 1)
    })()
    return () => {
      alive = false
    }
  }, [
    input.current?.pendingAssetIds,
    input.current?.referenceIds,
    input.draft,
    input.messages,
    input.nodeHashes,
    input.platform,
    input.projectId,
  ])

  useEffect(
    () => () => {
      for (const url of thumbCacheRef.current.values()) {
        URL.revokeObjectURL(url)
      }
      for (const url of referenceThumbCacheRef.current.values()) {
        URL.revokeObjectURL(url)
      }
      thumbCacheRef.current.clear()
      referenceThumbCacheRef.current.clear()
    },
    [],
  )

  return {
    addFromLibrary,
    attachFiles,
    thumbOf,
    thumbVersion,
  }
}

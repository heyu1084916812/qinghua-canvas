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
  takeAgentHandoff,
} from '../../../../features/canvas/agentHandoff'
import { loadAssetUrl } from '../../../../features/shared/assets/index'
import type { TaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'
import { parseMentions } from '../../text/MentionEditor'
import { viewportWorldOf } from './agentPanelViewHelpers'

interface AttachmentPatch {
  pendingAssetIds: string[]
}

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
    kind: 'node' | 'model' | 'skill',
    id: string,
    label: string,
  ) => void
  nodeLabelOf: (nodeId: string) => string
  patchSession: (patch: AttachmentPatch) => Promise<unknown>
  patchSessionDetached: (patch: AttachmentPatch) => void
  trackRun: TaskLifecycle['track']
}

export interface AgentAttachmentsController {
  addFromLibrary: (hash: string) => Promise<void>
  attachFiles: (files: FileList | null) => Promise<void>
  thumbOf: (nodeId: string) => string | null
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
    input.patchSessionDetached({
      pendingAssetIds: [
        ...new Set([...(input.current.pendingAssetIds ?? []), ...picked]),
      ],
    })
  }, [
    input.current,
    input.insertMention,
    input.nodeLabelOf,
    input.patchSessionDetached,
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
        await input.patchSession({
          pendingAssetIds: [...(input.current.pendingAssetIds ?? []), id],
        })
      }),
    [
      input.current,
      input.insertMention,
      input.library,
      input.nodeLabelOf,
      input.patchSession,
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
        await input.patchSession({
          pendingAssetIds: [
            ...(input.current.pendingAssetIds ?? []),
            ...added,
          ],
        })
      }),
    [
      input.current,
      input.insertMention,
      input.nodeLabelOf,
      input.patchSession,
      input.platform,
      input.projectId,
      input.store,
      input.trackRun,
      placeAsset,
    ],
  )

  const thumbCacheRef = useRef(new Map<string, string>())
  const [thumbVersion, setThumbVersion] = useState(0)
  const thumbOf = useCallback(
    (nodeId: string) => thumbCacheRef.current.get(nodeId) ?? null,
    [],
  )

  useEffect(() => {
    const refs = [
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
    if (refs.length === 0) return
    let alive = true
    void (async () => {
      let added = false
      for (const ref of refs) {
        if (thumbCacheRef.current.has(ref.id)) continue
        const hash = input.nodeHashes.get(ref.id)
        if (!hash) continue
        const meta = await loadAssetUrl(input.platform, hash)
        if (!alive || !meta.url) continue
        thumbCacheRef.current.set(ref.id, meta.url)
        added = true
      }
      if (added && alive) setThumbVersion((version) => version + 1)
    })()
    return () => {
      alive = false
    }
  }, [
    input.current?.pendingAssetIds,
    input.draft,
    input.messages,
    input.nodeHashes,
    input.platform,
  ])

  useEffect(
    () => () => {
      for (const url of thumbCacheRef.current.values()) {
        URL.revokeObjectURL(url)
      }
      thumbCacheRef.current.clear()
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

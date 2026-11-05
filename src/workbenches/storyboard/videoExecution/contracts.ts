import type { Dispatch, SetStateAction } from 'react'
import type { ChannelStore } from '../../../state/channel/channelStore'
import type {
  StoryboardCanvasEdge,
  StoryboardCanvasNode,
  StoryboardProjectionPort,
} from '../../../features/storyboard/canvasPort'
import type { StoryboardExecutionApi } from '../../../features/storyboard/execution/StoryboardExecutionProvider'
import type {
  StoryboardRunTarget,
  StoryboardVideoPostprocessAction,
} from '../../../features/storyboard/execution/storyboardRunPlan'
import type { StoryboardDocumentPort } from '../../../features/storyboard/execution/storyboardCommandExecutor'
import type { StoryboardRunPlan } from '../../../domain/storyboard/runTypes'
import type { StoryboardDoc, StoryboardShot } from '../../../domain/storyboard/storyboard'
import type { VideoUpscaleModelId } from '../../../domain/storyboard/videoUpscale'
import type { VideoEraseModelId } from '../../../domain/storyboard/videoErase'
import type { VideoEditModelId } from '../../../domain/storyboard/videoEdit'
import type { VideoExtendModelId } from '../../../domain/storyboard/videoExtend'
import type { StoragePort } from '../../../platform/ports'
import type {
  StoryboardActionKind,
  StoryboardActionStatePort,
} from '../useStoryboardActionState'

export interface VideoUpscaleTarget {
  channelId: string
  channelName: string
  model: VideoUpscaleModelId
  label: string
  resolutions: readonly string[]
  frameRates: readonly number[]
}

export interface VideoEraseTarget {
  channelId: string
  channelName: string
  model: VideoEraseModelId
  label: string
}

export interface VideoEditTarget {
  channelId: string
  channelName: string
  model: VideoEditModelId
  label: string
  resolutions: readonly string[]
  supportsReferenceImage: boolean
  requiresReferenceImage: boolean
}

export interface VideoExtendTarget {
  channelId: string
  channelName: string
  model: VideoExtendModelId
  label: string
  resolutions: readonly string[]
  durations: readonly number[]
}

export interface StoryboardVideoExecutionControllerArgs {
  currentDoc: () => StoryboardDoc | null
  graphNodes: readonly StoryboardCanvasNode[]
  graphEdges: readonly StoryboardCanvasEdge[]
  liveNodeIds: ReadonlySet<string>
  channels: ChannelStore
  storage: StoragePort
  projection: StoryboardProjectionPort
  execution: StoryboardExecutionApi
  documents: StoryboardDocumentPort
  projectId: string
  flush: () => Promise<void>
  replaceDoc: (doc: StoryboardDoc) => void
  setLay: Dispatch<
    SetStateAction<{
      kind: 'idle' | 'running' | 'done' | 'error'
      text: string
    }>
  >
  actionState: Pick<StoryboardActionStatePort, 'tryAcquire'>
}

export interface PreparedShotVideo {
  shot: StoryboardShot
  channelId: string
  model: string
  params: Record<string, unknown>
  videoMode?: string
  endFrameNodeId: string
  endFrameShot?: StoryboardShot
  includeEndFrame: boolean
  nextFrameAvailable: boolean
  imageNode?: StoryboardCanvasNode
  imageMime: string
  endFrameMime: string
}

export interface VideoExecStatus {
  kind: 'idle' | 'running' | 'done' | 'error'
  text: string
}

export type VideoStatusReporter = (status: VideoExecStatus) => void

export interface VideoRunPorts {
  currentDoc: () => StoryboardDoc | null
  graphNodes: readonly StoryboardCanvasNode[]
  graphEdges: readonly StoryboardCanvasEdge[]
  liveNodeIds: ReadonlySet<string>
  channels: ChannelStore
  storage: StoragePort
  projection: StoryboardProjectionPort
  execution: StoryboardExecutionApi
  documents: StoryboardDocumentPort
  projectId: string
  flush: () => Promise<void>
  replaceDoc: (doc: StoryboardDoc) => void
  report: VideoStatusReporter
  actionState: Pick<StoryboardActionStatePort, 'tryAcquire'>
}

export interface PostprocessInput {
  shot: StoryboardShot
  action: StoryboardVideoPostprocessAction
  target: StoryboardRunTarget
  prompt: string
  params: Record<string, unknown>
  includeReferenceImage?: boolean
  sourceNode?: StoryboardCanvasNode
  referenceNode?: StoryboardCanvasNode | null
  runningText: string
  successText: string
  transactionLabel: string
  busyKind: StoryboardActionKind
}

export type RunOutcome = Awaited<ReturnType<StoryboardExecutionApi['run']>>
export type { StoryboardRunPlan }

import {
  beginAgentHostDispose,
  finalizeAgentHostDispose,
  freezeAgentHostGeneration,
  removeAgentHost,
} from '../../../../app/AgentHostRegistry'
import {
  combineTaskShutdownControls,
  type TaskShutdownControl,
} from '../../../../features/shared/lifecycle/taskLifecycle'
import { beginCanvasExecutionRuntimeShutdown } from '../../execution/canvasExecutionRuntime'

export function createCanvasAgentHostShutdownControl({
  projectId,
  hostId,
  generation,
}: {
  projectId: string
  hostId: string
  generation: number
}): TaskShutdownControl {
  const releaseGeneration = freezeAgentHostGeneration(
    hostId,
    generation,
  )
  try {
    const executionShutdown =
      beginCanvasExecutionRuntimeShutdown(projectId)
    const hostShutdown = beginAgentHostDispose(
      hostId,
      generation,
    )
    const combined = combineTaskShutdownControls([
      hostShutdown,
      executionShutdown,
    ])
    return {
      ...combined,
      reopenIfIdle() {
        if (!combined.reopenIfIdle()) return false
        releaseGeneration()
        return true
      },
      releaseFinalized: releaseGeneration,
      finalize() {
        if (!combined.finalize()) return false
        finalizeAgentHostDispose(hostId, generation)
        removeAgentHost(hostId, generation)
        return true
      },
    }
  } catch (error) {
    releaseGeneration()
    throw error
  }
}

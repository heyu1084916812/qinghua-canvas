import { describe, expect, it } from 'vitest'
import { projectWorkbenchResults } from './workbenchResultProjection'

describe('ecommerce workbench result projection', () => {
  it('keeps the newest result, task lookup and newest run per node', () => {
    const stale = { id: 'r', nodeId: 'n', taskId: 't', updatedAt: 1, status: 'running' } as never
    const fresh = { id: 'r', nodeId: 'n', taskId: 't', updatedAt: 2, status: 'done' } as never
    const task = { id: 't', status: 'running' } as never
    const oldRun = { subjectId: 'n', createdAt: 1 } as never
    const newRun = { subjectId: 'n', createdAt: 2 } as never
    const projection = projectWorkbenchResults([stale], [fresh], [task], [oldRun, newRun])
    expect(projection.latestResultById.get('r')).toBe(fresh)
    expect(projection.taskById.get('t')).toBe(task)
    expect(projection.latestRunByNode.get('n')).toBe(newRun)
  })
})

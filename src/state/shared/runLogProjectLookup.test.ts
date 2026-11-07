import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import type { RunRecord } from '../../domain/shared/execution/runRecord'
import { createRunLogProjectLookup } from './runLogProjectLookup'

const project = (id: string, workbench: 'canvas' | 'ecommerce') => ({
  id,
  name: id,
  workbench,
  createdAt: 1,
  updatedAt: 1,
})

const record = (projectId: string): RunRecord => ({
  id: `run-${projectId}`,
  projectId,
  nodeId: 'node',
  taskId: 'task',
  version: 1,
  createdAt: 1,
  status: 'succeeded',
  durationMs: 1,
  inputs: [],
  outputHashes: [],
  params: {},
  fingerprint: 'fp',
})

describe('runLogProjectLookup', () => {
  it('batch-loads distinct project ids and caches missing lookups', async () => {
    const storage = createMemoryStorage()
    await storage.bulkPut('projects', [
      project('p1', 'canvas'),
      project('p2', 'ecommerce'),
    ] as never)
    const queryPage = storage.queryPage!.bind(storage)
    let calls = 0
    storage.queryPage = async (table, filter, options) => {
      calls += 1
      return queryPage(table, filter, options)
    }
    const lookup = createRunLogProjectLookup(storage)

    await lookup.prepare([record('p1'), record('p1'), record('p2'), record('missing')])
    expect(calls).toBe(1)
    expect(lookup.get('p1')?.workbench).toBe('canvas')
    expect(lookup.get('p2')?.workbench).toBe('ecommerce')
    expect(lookup.get('missing')).toBeNull()

    await lookup.prepare([record('p1'), record('missing')])
    expect(calls).toBe(1)
  })

  it('keeps the legacy storage fallback to one whole-table query', async () => {
    const storage = createMemoryStorage()
    storage.queryPage = undefined
    await storage.put('projects', project('p1', 'canvas') as never)
    const query = storage.query.bind(storage)
    let calls = 0
    storage.query = async (table, filter, options) => {
      if (table === 'projects') calls += 1
      return query(table, filter, options)
    }
    const lookup = createRunLogProjectLookup(storage)

    await lookup.prepare([record('p1'), record('p2')])
    expect(calls).toBe(1)
    expect(lookup.get('p1')?.workbench).toBe('canvas')
    expect(lookup.get('p2')).toBeNull()
  })
})

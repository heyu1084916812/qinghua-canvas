import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../../../platform/memory'
import type { RunRecord } from '../../../../domain/canvas/model/runRecord'
import {
  latestRunFailureOf,
  latestRunFailuresForNodes,
} from './agentRunState'

function run(
  id: string,
  nodeId: string,
  status: RunRecord['status'],
  createdAt: number,
  errorText?: string,
): RunRecord {
  return {
    id,
    nodeId,
    projectId: 'p1',
    version: createdAt,
    createdAt,
    status,
    inputs: [],
    params: {},
    outputHashes: [],
    fingerprint: id,
    taskId: id,
    durationMs: 1,
    ...(errorText ? { errorText } : {}),
  } as RunRecord
}

describe('Agent readResult 的持久运行状态', () => {
  it('只认最近一次 RunRecord；旧成功不能盖住新失败', () => {
    expect(
      latestRunFailureOf([
        run('old', 'n1', 'succeeded', 10),
        run('new', 'n1', 'failed', 20, '渠道超时'),
      ]),
    ).toEqual({ kind: 'failed', reason: '渠道超时' })
  })

  it('最近一次成功后，不泄漏更早的失败', () => {
    expect(
      latestRunFailureOf([
        run('old', 'n1', 'failed', 10, '旧失败'),
        run('new', 'n1', 'succeeded', 20),
      ]),
    ).toBeUndefined()
  })

  it('按节点和项目从真实存储读取最近失败原因', async () => {
    const platform = createMemoryPlatform()
    await platform.storage.put(
      'runRecords',
      run('old', 'n1', 'failed', 10, '旧失败') as never,
    )
    await platform.storage.put(
      'runRecords',
      run('new', 'n1', 'failed', 20, '新失败') as never,
    )
    await platform.storage.put(
      'runRecords',
      {
        ...run('other-project', 'n1', 'failed', 30, '别的项目'),
        projectId: 'p2',
      } as never,
    )
    const states = await latestRunFailuresForNodes(
      platform.storage,
      'p1',
      ['n1', 'n1', 'missing'],
    )
    expect([...states]).toEqual([['n1', { kind: 'failed', reason: '新失败' }]])
  })
})

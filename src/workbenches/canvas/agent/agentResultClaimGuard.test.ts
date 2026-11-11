import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../domain/shared/execution/types'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import { readResults } from './canvasReadTools'
import {
  resultClaimProblems,
  resultFactsLine,
  turnResultFacts,
} from './agentResultClaimGuard'

const runTurn = (readResultContent?: unknown): ChatMessage[] => [
  { role: 'user', content: '可以，生成吧' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'run', name: 'runNode', args: '{"nodeIds":["n1"]}' }] },
  {
    role: 'tool',
    toolCallId: 'run',
    toolName: 'runNode',
    content: JSON.stringify({ ok: true, outcomes: [{ nodeId: 'n1', ok: true, model: 'gpt-image-2.5' }] }),
  },
  ...(readResultContent === undefined
    ? []
    : ([
        { role: 'assistant', content: '', toolCalls: [{ id: 'rr', name: 'readResult', args: '{"nodeIds":["n1"]}' }] },
        { role: 'tool', toolCallId: 'rr', toolName: 'readResult', content: JSON.stringify(readResultContent) },
      ] as ChatMessage[])),
]

const realResult = {
  results: [
    {
      nodeId: 'n1',
      title: '咖啡店开业海报',
      status: 'ok',
      outputs: [{ hash: 'h1', mime: 'image/png', width: 1086, height: 1448 }],
    },
  ],
}

describe('完成说明核对（Agent 实测 Bug A7：声称 2K 实际 1086×1448）', () => {
  it('★★ 实测原句：运行后 readResult 是 1086×1448，却说「3:4 竖版 2K」→ 判为不实', () => {
    const facts = turnResultFacts(runTurn(realResult))
    const problems = resultClaimProblems('海报已经生成完成 ✅（模型 gpt-image-2.5，3:4 竖版 2K）', facts)
    expect(problems.join('\n')).toContain('2K')
    expect(problems.join('\n')).toContain('1086×1448')
  })

  it('★ 运行后还没 readResult 就报尺寸 / 张数 → 要求先核对', () => {
    const facts = turnResultFacts(runTurn())
    expect(facts.ran).toBe(true)
    expect(facts.readAfterRun).toBe(false)
    expect(resultClaimProblems('已生成 2 张 2K 海报', facts).join('\n')).toContain('readResult')
  })

  it('★ 与真实结果一致的说法放行', () => {
    const facts = turnResultFacts(runTurn(realResult))
    expect(resultClaimProblems('已生成 1 张海报，尺寸 1086×1448。', facts)).toEqual([])
    expect(resultClaimProblems('海报已生成，可以看看效果。', facts)).toEqual([])
  })

  it('★ 张数、具体像素不符都要拦', () => {
    const facts = turnResultFacts(runTurn(realResult))
    expect(resultClaimProblems('共生成 3 张。', facts).join('\n')).toContain('1 张')
    expect(resultClaimProblems('尺寸 1024×1536。', facts).join('\n')).toContain('1086×1448')
  })

  it('★ 声称的出图模型与运行记录不符要拦（实测说成 Agnes Image 2.5 Flash）', () => {
    const facts = turnResultFacts(runTurn(realResult))
    expect(resultClaimProblems('三张都由 Agnes Image 2.5 Flash 出图。', facts).join('\n')).toContain(
      'gpt-image-2.5',
    )
  })

  it('readResult 没给尺寸时，不许报具体尺寸档位', () => {
    const facts = turnResultFacts(
      runTurn({ results: [{ nodeId: 'n1', status: 'ok', outputs: [{ hash: 'h1', mime: 'image/png' }] }] }),
    )
    expect(resultClaimProblems('已出 2K 大图', facts).join('\n')).toContain('没有尺寸')
  })

  it('本轮没运行过（只是描述节点参数）→ 不核对', () => {
    const facts = turnResultFacts([{ role: 'user', content: '做张海报' }])
    expect(resultClaimProblems('节点设为 3:4 竖版 2K。', facts)).toEqual([])
  })

  it('事实行写出真实尺寸与张数', () => {
    expect(resultFactsLine(turnResultFacts(runTurn(realResult)))).toBe(
      '实际结果（readResult 核对）：「咖啡店开业海报」1086×1448；共 1 张。',
    )
  })
})

describe('readResult 带回真实像素', () => {
  it('★ 产物节点记着 naturalSize 时，outputs 带 width / height', () => {
    const store = {
      getSnapshot: () => ({
        nodes: [
          {
            id: 'n1',
            type: 'generation',
            title: '海报',
            data: { mode: 'image', assetHash: 'h1', naturalSize: { width: 1086, height: 1448 } },
          },
        ],
        edges: [],
      }),
    } as unknown as CanvasStore
    expect(readResults(store, ['n1'])[0]).toMatchObject({
      status: 'ok',
      outputs: [{ hash: 'h1', width: 1086, height: 1448 }],
    })
  })
})

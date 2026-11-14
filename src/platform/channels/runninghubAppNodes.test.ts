import { describe, expect, it } from 'vitest'
import { fillAppNodeValues } from './runninghubWorkflowRun'

/**
 * AI 应用的节点参数填写（对账 #1107）。
 *
 * 三层顺序：先按名字填提示词与常用三档 → 再按 `nodeId + fieldName` 精确覆盖 →
 * 没传的项一个都不动。这三件事**顺序错了就会互相覆盖**，所以逐条钉住。
 */

const nodes = () => [
  { nodeId: '6', nodeName: 'CLIP', fieldName: 'text', fieldType: 'STRING', fieldValue: '默认提示词' },
  { nodeId: '7', nodeName: 'Empty', fieldName: 'ratio', fieldType: 'LIST', fieldValue: '1:1' },
  { nodeId: '8', nodeName: 'Loader', fieldName: 'image', fieldType: 'IMAGE', fieldValue: '' },
]

describe('AI 应用节点参数', () => {
  it('提示词与常用三档老路径仍然生效（一个字段都没暴露时靠它）', () => {
    const list = [
      { nodeId: '6', fieldName: 'prompt', fieldType: 'STRING', fieldValue: '' },
      { nodeId: '7', fieldName: 'aspectRatio', fieldType: 'STRING', fieldValue: '' },
      { nodeId: '8', fieldName: 'resolution', fieldType: 'STRING', fieldValue: '' },
      { nodeId: '9', fieldName: 'duration', fieldType: 'NUMBER', fieldValue: '' },
    ]
    fillAppNodeValues(list, '一只橘猫', { ratio: '16:9', resolution: '4K', duration: 5 })
    expect(list.map((item) => item.fieldValue)).toEqual(['一只橘猫', '16:9', '4K', '5'])
  })

  it('面板暴露的字段按 nodeId + fieldName 精确覆盖（同名不同节点不会串）', () => {
    const list = nodes()
    fillAppNodeValues(list, '', {
      workflow: [
        { nodeId: '7', fieldName: 'ratio', fieldValue: '16:9' },
        { nodeId: '6', fieldName: 'text', fieldValue: '面板里改的词' },
      ],
    })
    expect(list[1]!.fieldValue).toBe('16:9')
    expect(list[0]!.fieldValue).toBe('面板里改的词')
  })

  it('面板没传的项保持应用默认值；脏三元组直接忽略', () => {
    const list = nodes()
    fillAppNodeValues(list, 'p', { workflow: [{ nodeId: '99', fieldName: 'nope', fieldValue: 'x' }, 'bad'] })
    expect(list[1]!.fieldValue).toBe('1:1')
    expect(list[2]!.fieldValue).toBe('')
  })

  it('精确覆盖在最后一步：同名字段先被老路径写、再被面板值盖掉', () => {
    const list = [
      { nodeId: '6', fieldName: 'prompt', fieldType: 'STRING', fieldValue: '' },
    ]
    fillAppNodeValues(list, '老路径提示词', {
      workflow: [{ nodeId: '6', fieldName: 'prompt', fieldValue: '面板提示词' }],
    })
    expect(list[0]!.fieldValue).toBe('面板提示词')
  })
})

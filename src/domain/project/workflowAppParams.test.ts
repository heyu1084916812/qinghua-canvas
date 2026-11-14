import { describe, expect, it } from 'vitest'
import { parseAppFieldData, parseAppNodeInfoList } from './workflowAppParams'

/**
 * 夹具照 **真机返回体**抄（2026-11-14 实测，`GET /api/webapp/apiCallDemo`）：
 * 一条 STRING + 一条 LIST + 一条 IMAGE，字段名与形状都是原样的。
 */
const liveNodeInfoList = [
  {
    nodeId: '122',
    nodeName: 'SeargePromptText',
    fieldName: 'prompt',
    fieldValue: '一个在浴室里的女孩',
    fieldType: 'STRING',
    fieldData: '["STRING", {"default": "", "multiline": true}]',
    description: 'prompt提示词',
  },
  {
    nodeId: '37',
    nodeName: 'RH_ComfyFluxKontext',
    fieldName: 'aspect_ratio',
    fieldValue: 'match_input_image',
    fieldType: 'LIST',
    fieldData:
      '[{"name":"match_input_image","index":"match_input_image","description":"匹配上传图像比例"},' +
      '{"name":"1:1","index":"1:1","description":"1:1 正方形"},' +
      '{"default":"match_input_image","description":"忽略"}]',
    description: '输出比例',
    descriptionEn: 'Output ratio',
  },
  {
    nodeId: '39',
    nodeName: 'LoadImage',
    fieldName: 'image',
    fieldValue: 'a293d89506f9c484f4ea5695f93024a80cd62ef98f4ee4543faba357536b37ec.jpg',
    fieldType: 'IMAGE',
    fieldData: '[[ "example.png", "keep_this_dic"], {"image_upload": true}]',
    description: '上传图像',
  },
]

describe('parseAppFieldData', () => {
  it('STRING 的多行标记认出来', () => {
    expect(parseAppFieldData('["STRING", {"default": "", "multiline": true}]')).toEqual({
      options: [],
      multiline: true,
    })
    expect(parseAppFieldData('["STRING", {"default": ""}]')).toEqual({
      options: [],
      multiline: false,
    })
  })

  it('★ LIST 只取带 name 的项（`{"default":…,"description":"忽略"}` 是哨兵，必须跳过）', () => {
    const parsed = parseAppFieldData(
      '[{"name":"a"},{"name":"b","description":"B"},{"default":"a","description":"忽略"}]',
    )
    expect(parsed.options).toEqual(['a', 'b'])
  })

  it('坏 JSON / 非数组 / 空串一律回空（宁可不给下拉，也不给假选项）', () => {
    expect(parseAppFieldData('not json').options).toEqual([])
    expect(parseAppFieldData('{"name":"a"}').options).toEqual([])
    expect(parseAppFieldData('').options).toEqual([])
  })
})

describe('parseAppNodeInfoList', () => {
  const fields = parseAppNodeInfoList(liveNodeInfoList)

  it('★ 应用字段默认全部暴露（与工作流的"默认全隐藏"相反）', () => {
    expect(fields).toHaveLength(3)
    expect(fields.every((field) => field.enabled)).toBe(true)
  })

  it('中文名当 label（比字段名有用），没有就回落 descriptionEn / fieldName', () => {
    expect(fields.map((field) => field.label)).toEqual(['prompt提示词', '输出比例', '上传图像'])
    const onlyEn = parseAppNodeInfoList([
      { nodeId: '1', fieldName: 'x', description: '', descriptionEn: 'X label' },
    ])
    expect(onlyEn[0]?.label).toBe('X label')
  })

  it('fieldType 映射到控件：多行文本 / 下拉 / 媒体', () => {
    expect(fields.map((field) => field.type)).toEqual(['textarea', 'select', 'image'])
  })

  it('下拉候选来自 fieldData，且哨兵项不在里面', () => {
    expect(fields[1]?.options).toEqual(['match_input_image', '1:1'])
    expect(fields[1]?.options).not.toContain('忽略')
  })

  it('媒体槽标必填并带顺序；分组取 nodeName', () => {
    expect(fields[2]?.required).toBe(true)
    expect(fields[2]?.mediaOrder).toBe(0)
    expect(fields[2]?.group).toBe('LoadImage')
  })

  it('LIST 但候选解析不出来 ⇒ 回落 text（不给空下拉）', () => {
    const list = parseAppNodeInfoList([
      { nodeId: '5', fieldName: 'model', fieldType: 'LIST', fieldData: 'oops' },
    ])
    expect(list[0]?.type).toBe('text')
  })

  it('数字 / 布尔类型照声明走；seed 名字被认出来', () => {
    const typed = parseAppNodeInfoList([
      { nodeId: '7', fieldName: 'steps', fieldType: 'NUMBER', fieldValue: '20' },
      { nodeId: '7', fieldName: 'flag', fieldType: 'BOOLEAN', fieldValue: 'false' },
      { nodeId: '7', fieldName: 'seed', fieldType: 'INT', fieldValue: '42' },
    ])
    expect(typed.map((field) => field.type)).toEqual(['number', 'boolean', 'number'])
    expect(typed[2]?.seed).toBe(true)
    expect(typed[2]?.step).toBe(1)
  })

  it('没有 fieldType 时按值 / 名字推（与工作流同一条启发式）', () => {
    const inferred = parseAppNodeInfoList([
      { nodeId: '9', fieldName: 'image', fieldValue: 'x.png' },
      { nodeId: '9', fieldName: 'note', fieldValue: '随便写' },
    ])
    expect(inferred.map((field) => field.type)).toEqual(['image', 'text'])
  })

  it('缺 nodeId / fieldName 的残行、以及重复项都丢掉', () => {
    const cleaned = parseAppNodeInfoList([
      { fieldName: 'a' },
      { nodeId: '1', fieldName: '' },
      { nodeId: '1', fieldName: 'a' },
      { nodeId: '1', fieldName: 'a' },
    ])
    expect(cleaned.map((field) => field.id)).toEqual(['1::a'])
  })

  it('不是数组时回空（坏响应不该让面板炸）', () => {
    expect(parseAppNodeInfoList(null)).toEqual([])
    expect(parseAppNodeInfoList({})).toEqual([])
  })
})

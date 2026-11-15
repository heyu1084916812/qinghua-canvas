import { describe, expect, it } from 'vitest'
import {
  inferWorkflowParamType,
  isWorkflowLinkValue,
  mergeRefetchedFields,
  normalizeWorkflowEntries,
  normalizeWorkflowField,
  parseWorkflowJsonToFields,
  workflowEntriesRowId,
  workflowEntryIdOf,
  workflowModelId,
  type WorkflowParamField,
} from './workflowParams'
import {
  WORKFLOW_SEED_MAX,
  exposedFields,
  fieldValueOf,
  missingRequiredFields,
  normalizeWorkflowSeed,
  randomWorkflowSeed,
  workflowEntryCategory,
  workflowNodeInfoList,
} from './workflowParamValues'

/** 一份贴近真实 `getJsonApiFormat` 的夹具：两个节点、一个连线值、一个中文标题 */
const workflowJson = {
  '46': {
    class_type: 'WanVideoSampler',
    _meta: { title: '采样器' },
    inputs: {
      prompt: '一只猫',
      seed: 42,
      steps: 30,
      use_custom_audio: false,
      global_prompt: ['12', 0],
      image: 'pasted/abc.png',
    },
  },
  '12': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '负面提示词', strength: 0.8 },
  },
}

describe('parseWorkflowJsonToFields', () => {
  it('把每个节点的 inputs 摊平，并跳过连线值', () => {
    const fields = parseWorkflowJsonToFields(workflowJson)
    const ids = fields.map((f) => f.id)
    /** 节点键是数字串，JS 按数值升序排列（`12` 在 `46` 前），所以顺序是稳定的 */
    expect(ids).toEqual([
      '12::text',
      '12::strength',
      '46::prompt',
      '46::seed',
      '46::steps',
      '46::use_custom_audio',
      '46::image',
    ])
    /** 连线值 `["12", 0]` 是连接，不是参数 —— 必须缺席 */
    expect(ids).not.toContain('46::global_prompt')
  })

  it('★ 默认全部隐藏（上游不给"哪些该开放"，默认全开会把内部参数倒出来）', () => {
    const fields = parseWorkflowJsonToFields(workflowJson)
    expect(fields.every((f) => f.enabled === false)).toBe(true)
  })

  it('分组取节点标题，取不到回落 class_type', () => {
    const fields = parseWorkflowJsonToFields(workflowJson)
    expect(fields.find((f) => f.id === '46::prompt')?.group).toBe('采样器')
    expect(fields.find((f) => f.id === '12::text')?.group).toBe('CLIPTextEncode')
  })

  it('种子字段被认出来，媒体字段按出现顺序编号', () => {
    const fields = parseWorkflowJsonToFields(workflowJson)
    expect(fields.find((f) => f.id === '46::seed')?.seed).toBe(true)
    const image = fields.find((f) => f.id === '46::image')
    expect(image?.type).toBe('image')
    expect(image?.mediaOrder).toBe(0)
    expect(image?.required).toBe(true)
  })

  it('非对象输入一律回空数组（坏数据不该让面板打不开）', () => {
    expect(parseWorkflowJsonToFields(null)).toEqual([])
    expect(parseWorkflowJsonToFields([])).toEqual([])
    expect(parseWorkflowJsonToFields('nope')).toEqual([])
  })
})

describe('inferWorkflowParamType', () => {
  it('媒体按字段名 / 扩展名认', () => {
    expect(inferWorkflowParamType('image', '')).toBe('image')
    expect(inferWorkflowParamType('ref_video', '')).toBe('video')
    expect(inferWorkflowParamType('audio', '')).toBe('audio')
    expect(inferWorkflowParamType('path', 'pasted/x.mp4')).toBe('video')
  })

  it('布尔与数字按值认', () => {
    expect(inferWorkflowParamType('use_custom_audio', 'false')).toBe('boolean')
    expect(inferWorkflowParamType('steps', '30')).toBe('number')
  })

  it('`clip_name` 是 CLIP 模型文件名，不是视频槽（真拉 Z-Image 时踩过）', () => {
    expect(inferWorkflowParamType('clip_name', 'umt5_xxl_fp8.safetensors')).toBe('text')
    expect(inferWorkflowParamType('clip', '')).toBe('text')
    /* 真的视频字段照旧 */
    expect(inferWorkflowParamType('ref_video', '')).toBe('video')
  })

  it('★ 推不出就回落 text —— 不许猜成下拉（候选集不在 API 格式里）', () => {
    expect(inferWorkflowParamType('resize_method', 'maintain aspect ratio')).toBe('text')
    expect(inferWorkflowParamType('sampler', '')).toBe('text')
  })
})

describe('normalizeWorkflowField', () => {
  it('缺 nodeId 或 fieldName 的残行直接丢掉', () => {
    expect(normalizeWorkflowField({ fieldName: 'prompt' })).toBeNull()
    expect(normalizeWorkflowField({ nodeId: '1' })).toBeNull()
    expect(normalizeWorkflowField(null)).toBeNull()
  })

  it('保留用户的暴露状态 / 名字 / 范围，坏类型按值回推', () => {
    const field = normalizeWorkflowField({
      id: '46::steps',
      nodeId: '46',
      fieldName: 'steps',
      type: '胡说',
      label: '步数',
      enabled: true,
      min: '1',
      max: 100,
      step: 1,
      value: '30',
    })
    expect(field).toMatchObject({
      type: 'number',
      label: '步数',
      enabled: true,
      min: 1,
      max: 100,
      step: 1,
    })
  })

  it('options 支持数组与逗号 / 换行分隔的字符串', () => {
    expect(
      normalizeWorkflowField({ nodeId: '1', fieldName: 'x', options: ['a', ' b ', 'a'] })?.options,
    ).toEqual(['a', 'b'])
    expect(
      normalizeWorkflowField({ nodeId: '1', fieldName: 'x', options: 'a,b\nc' })?.options,
    ).toEqual(['a', 'b', 'c'])
  })
})

describe('mergeRefetchedFields', () => {
  it('★ 重新拉参数保留用户配置，只更新上游的现值与分组', () => {
    const previous = parseWorkflowJsonToFields(workflowJson).map((field) =>
      field.id === '46::steps'
        ? { ...field, enabled: true, label: '步数', min: 1, max: 60, step: 1, type: 'number' as const }
        : field,
    )
    const refetched = parseWorkflowJsonToFields({
      '46': {
        _meta: { title: '采样器 v2' },
        inputs: { prompt: '一只猫', steps: 50 },
      },
    })
    const merged = mergeRefetchedFields(previous, refetched)
    const steps = merged.find((f) => f.id === '46::steps')
    expect(steps).toMatchObject({
      value: '50',
      enabled: true,
      label: '步数',
      max: 60,
      group: '采样器 v2',
    })
    /** 上游删掉的字段不该继续留着（否则提交时会打到一个不存在的 inputs 上） */
    expect(merged.map((f) => f.id)).toEqual(['46::prompt', '46::steps'])
  })
})

describe('workflowNodeInfoList', () => {
  const base: WorkflowParamField[] = [
    {
      id: '46::prompt',
      nodeId: '46',
      fieldName: 'prompt',
      type: 'textarea',
      label: '提示词',
      value: '默认提示词',
      enabled: true,
      group: '采样器',
      options: [],
      min: null,
      max: null,
      step: null,
      seed: false,
      required: true,
      mediaOrder: 0,
    },
    {
      id: '46::seed',
      nodeId: '46',
      fieldName: 'seed',
      type: 'number',
      label: '种子',
      value: '42',
      enabled: true,
      group: '采样器',
      options: [],
      min: null,
      max: null,
      step: 1,
      seed: true,
      required: false,
      mediaOrder: 0,
    },
    {
      id: '46::steps',
      nodeId: '46',
      fieldName: 'steps',
      type: 'number',
      label: '步数',
      value: '30',
      enabled: false,
      group: '采样器',
      options: [],
      min: null,
      max: null,
      step: 1,
      seed: false,
      required: false,
      mediaOrder: 0,
    },
  ]

  it('★ 只发暴露且非空的字段（隐藏项交给工作流默认值）', () => {
    const list = workflowNodeInfoList({ fields: base, values: { '46::prompt': '一只狗' } })
    expect(list).toEqual([
      { nodeId: '46', fieldName: 'prompt', fieldValue: '一只狗' },
      { nodeId: '46', fieldName: 'seed', fieldValue: '42' },
    ])
  })

  it('媒体字段用上传回来的 fileName，且覆盖掉工作流里的旧值', () => {
    const withImage: WorkflowParamField[] = [
      {
        ...base[0]!,
        id: '12::image',
        nodeId: '12',
        fieldName: 'image',
        type: 'image',
        value: '旧的/pasted.png',
      },
    ]
    const list = workflowNodeInfoList({
      fields: withImage,
      mediaValues: { '12::image': 'api/uploaded-123.png' },
    })
    expect(list).toEqual([
      { nodeId: '12', fieldName: 'image', fieldValue: 'api/uploaded-123.png' },
    ])
  })

  it('种子按 32 位归一（负数取绝对值、超界取模）', () => {
    const list = workflowNodeInfoList({ fields: base, values: { '46::seed': '-1' } })
    expect(list.find((item) => item.fieldName === 'seed')?.fieldValue).toBe('1')
  })

  it('显式清空的字段不下发（不是发空串）', () => {
    const list = workflowNodeInfoList({ fields: base, values: { '46::prompt': '' } })
    expect(list.map((item) => item.fieldName)).toEqual(['seed'])
  })
})

describe('missingRequiredFields', () => {
  it('只看暴露字段：隐藏的必填项不拦用户（我们连它的值都没有）', () => {
    const fields = parseWorkflowJsonToFields(workflowJson).map((field) =>
      field.id === '46::image'
        ? { ...field, enabled: false }
        : field.id === '46::prompt'
          ? { ...field, enabled: true, required: true }
          : field,
    )
    const missing = missingRequiredFields(fields, { '46::prompt': '  ' })
    expect(missing.map((f) => f.id)).toEqual(['46::prompt'])
  })
})

describe('种子与取值', () => {
  it('normalizeWorkflowSeed 四种边界', () => {
    expect(normalizeWorkflowSeed('42')).toBe('42')
    expect(normalizeWorkflowSeed('-7')).toBe('7')
    expect(normalizeWorkflowSeed(String(WORKFLOW_SEED_MAX + 3))).toBe('2')
    expect(normalizeWorkflowSeed('abc')).toBe('0')
  })

  it('randomWorkflowSeed 落在 uint32 区间内', () => {
    expect(randomWorkflowSeed(() => 0)).toBe('0')
    expect(randomWorkflowSeed(() => 0.999999)).toBe(String(Math.floor(0.999999 * (WORKFLOW_SEED_MAX + 1))))
    expect(Number(randomWorkflowSeed())).toBeLessThanOrEqual(WORKFLOW_SEED_MAX)
  })

  it('fieldValueOf：填过用节点的，没填过用工作流现值，显式空串就是空串', () => {
    const field = parseWorkflowJsonToFields(workflowJson).find((f) => f.id === '46::prompt')!
    expect(fieldValueOf(field, undefined)).toBe('一只猫')
    expect(fieldValueOf(field, { '46::prompt': '新的' })).toBe('新的')
    expect(fieldValueOf(field, { '46::prompt': '' })).toBe('')
  })
})

describe('条目与模型 id', () => {
  it('模型 id 往返', () => {
    expect(workflowModelId('2058541134623891458')).toBe('workflow:2058541134623891458')
    expect(workflowEntryIdOf('workflow:2058541134623891458')).toBe('2058541134623891458')
    expect(workflowEntryIdOf('app:123')).toBeNull()
    expect(workflowEntryIdOf('workflow:')).toBeNull()
  })

  it('条目清单按渠道分行的行 id', () => {
    expect(workflowEntriesRowId('ch_1')).toBe('workflow:entries:ch_1')
  })

  it('normalizeWorkflowEntries：去重、坏字段丢弃、provider 坏值回落 runninghub', () => {
    const entries = normalizeWorkflowEntries([
      { id: 'w1', title: '我的工作流', provider: '胡说', fields: [{ nodeId: '1', fieldName: 'a' }, {}] },
      { id: 'w1', title: '重复', fields: [] },
      { id: '', title: '没有 id' },
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: 'w1', title: '我的工作流', provider: 'runninghub' })
    expect(entries[0]?.fields).toHaveLength(1)
  })

  it('类别只看暴露出来的媒体字段里有没有视频', () => {
    const fields = parseWorkflowJsonToFields({
      '1': { inputs: { prompt: 'x', video: '' } },
    })
    const entry = { id: 'w', title: 'w', provider: 'runninghub' as const, fields, fetchedAt: 0 }
    expect(workflowEntryCategory(entry)).toBe('image')
    expect(workflowEntryCategory({
      ...entry,
      fields: fields.map((f) => ({ ...f, enabled: true })),
    })).toBe('video')
  })

  it('isWorkflowLinkValue 只认 [string, number]', () => {
    expect(isWorkflowLinkValue(['12', 0])).toBe(true)
    expect(isWorkflowLinkValue(['12'])).toBe(false)
    expect(isWorkflowLinkValue([12, 0])).toBe(false)
    expect(isWorkflowLinkValue(['a', 0, 1])).toBe(false)
  })

  it('exposedFields 保持面板顺序', () => {
    const fields = parseWorkflowJsonToFields(workflowJson).map((f, i) => ({ ...f, enabled: i % 2 === 0 }))
    expect(exposedFields(fields).map((f) => f.id)).toEqual(fields.filter((_, i) => i % 2 === 0).map((f) => f.id))
  })
})

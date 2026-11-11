import { describe, expect, it } from 'vitest'
import {
  REFERENCE_CURATION_SYSTEM_PROMPT,
  buildReferenceCurationPrompt,
  parseReferenceCurationText,
  referenceUsageId,
} from './referenceCuration'
import { curatedTitleOf, isAutoReferenceTitle } from './referenceTitle'

describe('reference curation rules', () => {
  it('解析真实 What、usage、HowToUse 和身份锚点', () => {
    const parsed = parseReferenceCurationText(JSON.stringify({
      what: '深绿色品牌标志，横向字标，留白充足。',
      usage: 'identityAnchor',
      howToUse: '本任务保持标志字形和比例不变，只适配背景与留白。',
      identityAnchor: true,
      limitations: [],
    }))

    expect(parsed).toEqual({
      ok: true,
      analysis: {
        title: '',
        what: '深绿色品牌标志，横向字标，留白充足。',
        usage: 'identityAnchor',
        howToUse: '本任务保持标志字形和比例不变，只适配背景与留白。',
        identityAnchor: true,
        roleClear: true,
        relevant: true,
        limitations: [],
      },
    })
  })

  it('G3：subject（主体 / 产品锁定）是独立用法，中文别名产品 / 主体映射到它', () => {
    const parsed = parseReferenceCurationText(JSON.stringify({
      what: '白色保温杯，哑光杯身，银色杯盖。',
      usage: 'subject',
      howToUse: '借：杯子外形与配色，原样放进海报；避：原图的白底与阴影。',
    }))
    expect(parsed).toMatchObject({ ok: true, analysis: { usage: 'subject', identityAnchor: false } })
    for (const alias of ['产品', '主体', '商品']) {
      expect(parseReferenceCurationText(JSON.stringify({
        what: 'x', usage: alias, howToUse: 'y',
      }))).toMatchObject({ ok: true, analysis: { usage: 'subject' } })
    }
    expect(REFERENCE_CURATION_SYSTEM_PROMPT).toContain('subject')
  })

  it('拒绝缺少 What 或 HowToUse 的假分析', () => {
    expect(parseReferenceCurationText('{"usage":"style"}')).toEqual({
      ok: false,
      reason: '分析结果缺少 What',
    })
    expect(parseReferenceCurationText(JSON.stringify({
      what: '一张米色背景图',
      usage: 'style',
    }))).toEqual({
      ok: false,
      reason: '分析结果缺少 HowToUse',
    })
  })

  it('usage id 对同一任务稳定，对不同任务隔离', () => {
    const base = {
      projectId: 'p1',
      taskKey: 'simple_generate',
      itemId: 'ref-1',
    }
    expect(referenceUsageId(base)).toBe(referenceUsageId({ ...base }))
    expect(referenceUsageId(base)).not.toBe(
      referenceUsageId({ ...base, taskKey: 'reference_edit' }),
    )
  })
})

describe('C1 参考卡语义标题', () => {
  it('文件名 / Image 17 / 截图 这类算自动标题；用户起的名不算', () => {
    for (const title of ['_Image 17.jpg', 'IMG_2031', 'image 3', '截图 2026-11-11', '微信图片_20261111', '', 'cup.png']) {
      expect(isAutoReferenceTitle(title), title).toBe(true)
    }
    for (const title of ['拿铁杯产品图', 'Anbel', '品牌 Logo']) {
      expect(isAutoReferenceTitle(title), title).toBe(false)
    }
  })

  it('模型短名去引号、截断；给成文件名就丢弃', () => {
    expect(curatedTitleOf('「拿铁杯产品图」')).toBe('拿铁杯产品图')
    expect(curatedTitleOf('一张非常非常非常长的极简风格海报排版参考图')).toHaveLength(16)
    expect(curatedTitleOf('IMG_001.jpg')).toBe('')
    expect(curatedTitleOf(42)).toBe('')
    const parsed = parseReferenceCurationText(JSON.stringify({
      title: '极简海报排版', what: 'x', usage: 'composition', howToUse: 'y',
    }))
    expect(parsed).toMatchObject({ ok: true, analysis: { title: '极简海报排版' } })
    expect(REFERENCE_CURATION_SYSTEM_PROMPT).toContain('不要用文件名')
  })
})

describe('C4 「怎么用」只写借什么、避什么', () => {
  it('系统提示词与单条提示都限定借 / 避，并禁止图里没有的设计建议', () => {
    expect(REFERENCE_CURATION_SYSTEM_PROMPT).toContain('格式「借：…；避：…」')
    expect(REFERENCE_CURATION_SYSTEM_PROMPT).toContain('不要提出图里没有的新设计建议')
    expect(REFERENCE_CURATION_SYSTEM_PROMPT).not.toContain('是否锁定身份。')
    const prompt = buildReferenceCurationPrompt({
      item: {
        id: 'r1', projectId: 'p1', title: 't', source: 'file', kind: 'image',
        what: '', createdAt: 1, updatedAt: 1,
      },
      task: '做一张海报',
      imageLabels: ['参考图 1'],
    })
    expect(prompt).toContain('不写图里没有的设计建议')
  })
})


describe('参考分析的 roleClear / relevant（G5 修订）', () => {
  it('模型给出 false 时如实保留；缺省按 true（不凭空发问）', () => {
    const base = { what: 'x', usage: 'style', howToUse: '借：配色；避：文字' }
    expect(parseReferenceCurationText(JSON.stringify({ ...base, roleClear: false, relevant: false })))
      .toMatchObject({ ok: true, analysis: { roleClear: false, relevant: false } })
    expect(parseReferenceCurationText(JSON.stringify(base)))
      .toMatchObject({ ok: true, analysis: { roleClear: true, relevant: true } })
  })

  it('系统提示词要求判断不出就写 roleClear=false、不要硬猜', () => {
    expect(REFERENCE_CURATION_SYSTEM_PROMPT).toContain('roleClear')
    expect(REFERENCE_CURATION_SYSTEM_PROMPT).toContain('不要硬猜')
    expect(REFERENCE_CURATION_SYSTEM_PROMPT).toContain('relevant')
  })
})

describe('G9：按用户回答重写用法的提示词', () => {
  const item = {
    id: 'ref-cup', projectId: 'p1', title: '杯子', source: 'file' as const, kind: 'image' as const,
    what: '白色杯子', createdAt: 1, updatedAt: 1,
  }
  it('带回答时写明最高优先级、不得矛盾、不照抄原文，仍按借/避格式', () => {
    const prompt = buildReferenceCurationPrompt({ item, task: '做海报', imageLabels: ['参考图 1'], userAnswer: '第 2 张锁定产品' })
    expect(prompt).toContain('用户对这张图的确认（最高优先级）')
    expect(prompt).toContain('用户在问题卡里回答：第 2 张锁定产品')
    expect(prompt).toContain('不得与回答矛盾')
    expect(prompt).toContain('不要把回答原文照抄成 howToUse')
    expect(prompt).toContain('「借：…；避：…」')
  })
  it('没有回答时不出现该段', () => {
    expect(buildReferenceCurationPrompt({ item, task: '做海报', imageLabels: [] })).not.toContain('最高优先级')
  })
})

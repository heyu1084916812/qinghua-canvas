import { describe, expect, it } from 'vitest'
import { describeRhError } from './runninghub'

/**
 * 上游错误码 → 人话（2026-11-14 真机口径）。
 *
 * 这份单测的重点**不是文案好看**，而是**分支顺序**：`821` 的原文里带"余额不足"，
 * 一旦排在通用的「余额」分支后面就会被吃掉，用户看到的变成含混的"额度不够"，
 * 于是继续以为"我还有 30 分怎么跑不动"是软件 bug。顺序错了这条就会红。
 */
describe('describeRhError', () => {
  it('★ 821（付费积分不足）不能被通用的"余额"分支吃掉', () => {
    const text = describeRhError(
      {
        code: 821,
        msg: '付费积分余额不足，消费级 API 调用仅支持使用付费积分，免费积分不可用于 API 调用',
      },
      '提交失败',
    )
    expect(text).toContain('付费积分')
    expect(text).toContain('免费积分')
    /** 通用分支的专属说法不许出现（出现了就说明被前面那条吞了） */
    expect(text).not.toContain('这个账号的额度不够')
  })

  it('1014 说清是账号等级限制，而不是配置错', () => {
    const text = describeRhError(
      {
        errorCode: '1014',
        errorMessage: 'Access Denied: Standard Model API is restricted to Enterprise-Shared API Keys only.',
      },
      '提交失败',
    )
    expect(text).toContain('企业级-共享')
    expect(text).toContain('app: 应用或工作流')
  })

  it('812 仍然指向充值，且不再讲"两把 Key"', () => {
    const text = describeRhError({ code: 812, msg: '企业版余额不足' }, '提交失败')
    expect(text).toContain('额度不够')
    expect(text).not.toContain('币 Key')
  })

  it('鉴权类错误只提一个 Key（一条渠道一个 Key 就够了）', () => {
    const text = describeRhError({ code: 401, msg: 'unauthorized' }, '提交失败')
    expect(text).toContain('一条渠道只需要一个 Key')
    expect(text).not.toContain('别混用')
  })

  it('1007 只翻译"参数没过校验"，不编字数门槛', () => {
    const text = describeRhError({ code: 1007, msg: "field 'prompt' length 3 is less than the minimum length 5" }, '提交失败')
    expect(text).toContain('没通过服务端校验')
    expect(text).not.toContain('至少 5')
  })

  it('认不出来的错误码原样透出上游原话', () => {
    expect(describeRhError({ code: 9999, msg: 'weird upstream thing' }, '提交失败')).toBe(
      'weird upstream thing',
    )
  })
})

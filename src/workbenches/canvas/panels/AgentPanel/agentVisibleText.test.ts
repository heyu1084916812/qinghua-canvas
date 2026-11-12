import { describe, expect, it } from 'vitest'
import { publicProcessText, visibleAssistantReply } from './agentVisibleText'
import sessionModelSource from './useAgentPanelSessionModel.ts?raw'

describe('publicProcessText（Agent 实测 Bug A5：内部提示 / 推理泄漏到对话）', () => {
  it('★ 实测泄漏的英文内部指令整段丢掉', () => {
    expect(publicProcessText('Report concisely. Ask if run.')).toBe('')
    expect(publicProcessText('Report concisely. Ask if run.Report concisely. Ask if run.')).toBe('')
    expect(publicProcessText('Let me run it.')).toBe('')
    expect(publicProcessText('Let me run it.\nLet me run it.')).toBe('')
    expect(publicProcessText('User approved. Run the node.')).toBe('')
  })

  it('★ 中英混排时只留中文公开过程，逐句过滤', () => {
    expect(publicProcessText('先核对参考图。Let me check the graph. 再确认 Logo 比例。')).toBe(
      '先核对参考图。再确认 Logo 比例。',
    )
    expect(publicProcessText('准备调用 readGraph\nThe user wants a poster.\n先看画布')).toBe(
      '准备调用 readGraph\n先看画布',
    )
  })

  it('中文思考原样保留（含数字、英文专名）', () => {
    expect(publicProcessText('先确认 3:4 比例，用 GPT Image 2 出图。')).toBe(
      '先确认 3:4 比例，用 GPT Image 2 出图。',
    )
  })

  it('空白输入返回空串', () => {
    expect(publicProcessText('  \n ')).toBe('')
  })
})

describe('visibleAssistantReply（工具原始 JSON / 协议标记不当正文）', () => {
  it('★ 整段是工具调用 JSON → 不显示', () => {
    expect(visibleAssistantReply('{"tool":"runNode","args":{"nodeIds":["n1"]}}')).toBe('')
    expect(visibleAssistantReply('{"name":"applyPlan","arguments":"{}"}')).toBe('')
    expect(visibleAssistantReply('```json\n{"tool":"final","args":{}}\n```')).toBe('')
  })

  it('★ 协议标记段落被剥掉，正文保留', () => {
    expect(
      visibleAssistantReply(
        '海报节点已建好。<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>runNode<｜tool▁sep｜>{}<｜tool▁call▁end｜><｜tool▁calls▁end｜>',
      ),
    ).toBe('海报节点已建好。')
    expect(visibleAssistantReply('好的。\n<tool_call>{"name":"runNode"}</tool_call>')).toBe('好的。')
  })

  it('★ 正文末尾混入的英文内部指令行被去掉', () => {
    expect(
      visibleAssistantReply('需要我现在开始生成吗？\nReport concisely. Ask if run.\nReport concisely. Ask if run.'),
    ).toBe('需要我现在开始生成吗？')
    expect(visibleAssistantReply('标题：COMING SOON')).toBe('标题：COMING SOON')
  })

  it('普通正文（含一般 JSON 示例以外的内容）原样返回', () => {
    expect(visibleAssistantReply('已建好 1 个节点，要现在跑吗？')).toBe('已建好 1 个节点，要现在跑吗？')
    expect(visibleAssistantReply('配色：{"主色":"#4A5D3A"}')).toBe('配色：{"主色":"#4A5D3A"}')
  })
})

describe('实时过程流接线', () => {
  it('★ 面板读到的 liveProcess 先过 publicProcessText', () => {
    expect(sessionModelSource).toMatch(/publicProcessText\(runPresentation\.liveProcessFor\(/)
  })
})

describe('过程行不泄漏原始字段（2026-11-12）', () => {
  it('Options: "…" / question: / JSON 片段整行不显示，正常中文过程保留', () => {
    const text = [
      '用户要月饼详情，先看画布。',
      'Options: "我给你品牌名和口味", "用占位通用文字（如流心奶黄）"',
      'question: "这套详情页按什么尺寸出图？"',
      '{"questions": [{"question": "尺寸？"}]}',
      '- options: ["3:4", "1:1"]',
      '再决定要问哪几件事。',
    ].join('\n')
    expect(publicProcessText(text)).toBe('用户要月饼详情，先看画布。\n再决定要问哪几件事。')
  })
})

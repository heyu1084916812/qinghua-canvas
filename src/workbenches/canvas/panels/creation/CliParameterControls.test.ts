import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultCliTools } from '../../../../domain/shared/cliTools'
import { CliParameterControls } from './CliParameterControls'

/** 「本机 CLI」来源的参数行（对账 #1133）：只读参数模板 + 拦截原因；API / 工作流的参数一个都不出现 */
const jimeng = defaultCliTools().find((tool) => tool.id === 'jimeng')!
const noop = () => {}
const render = (over: Partial<Parameters<typeof CliParameterControls>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(CliParameterControls, {
      tool: { tool: jimeng, status: 'ok' },
      blockedReason: null,
      open: false,
      onToggle: noop,
      onClose: noop,
      onOpenCliSettings: noop,
      ...over,
    }),
  )

describe('CLI 参数行', () => {
  it('只有一枚「参数模板」chip，没有比例 / 清晰度 / 工作流字段', () => {
    const html = render()
    expect(html).toContain('data-param-chip="cliTemplate"')
    expect(html).toContain('参数模板')
    for (const name of ['ratio', 'resolution', 'quality', 'count', 'workflowParams', 'workflowInstance']) {
      expect(html).not.toContain(`data-param-chip="${name}"`)
    }
  })

  it('展开后显示这次会跑的命令 + 本机 CLI 设置入口', () => {
    const html = render({ open: true })
    expect(html).toContain('data-cli-template')
    expect(html).toContain(jimeng.program)
    expect(html).toContain('data-cli-settings')
  })

  it('被拦时就地写原因', () => {
    expect(render({ blockedReason: '本机未检测到「即梦」' })).toContain('data-source-blocked="cli"')
    expect(render()).not.toContain('data-source-blocked')
  })
})

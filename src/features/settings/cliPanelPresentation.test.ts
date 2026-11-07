import { describe, expect, it } from 'vitest'
import { defaultCliTools } from '../../domain/shared/cliTools'
import {
  primaryCliAction,
  probeSummary,
  runDiagnosticLabel,
} from './cliPanelPresentation'

const tools = defaultCliTools()
const tool = (id: string) => tools.find((item) => item.id === id)!

describe('CLI panel presentation', () => {
  it('shows detection before asking for any action', () => {
    expect(primaryCliAction(tool('codex'), undefined)).toMatchObject({
      kind: 'checking',
      label: '检测中…',
    })
  })

  it('does not call the browser-only surface a detection failure', () => {
    expect(
      primaryCliAction(tool('codex'), {
        kind: 'unavailable',
        detail: '仅桌面应用可用',
      }),
    ).toMatchObject({ kind: 'unavailable', label: '桌面应用可用' })
  })

  it('offers installation only when the command is missing', () => {
    expect(
      primaryCliAction(tool('codex'), { kind: 'missing', detail: '未找到命令' }),
    ).toMatchObject({ kind: 'install', label: '安装 CLI' })
    expect(
      primaryCliAction(tool('jimeng'), { kind: 'missing', detail: '未找到命令' }),
    ).toMatchObject({ kind: 'install-help', label: '查看安装方式', opensDetails: true })
  })

  it('routes installed tools to the smallest required login action', () => {
    const found = { kind: 'found' as const, detail: '已找到' }
    expect(primaryCliAction(tool('runninghub'), found)).toMatchObject({
      kind: 'key',
      opensDetails: true,
    })
    expect(primaryCliAction(tool('codex'), found)).toMatchObject({ kind: 'login' })
  })

  it('requires an explicit second click before running a billable diagnostic', () => {
    expect(runDiagnosticLabel(false)).toBe('运行参数模板')
    expect(runDiagnosticLabel(true)).toBe('确认运行（可能计费）')
  })

  it('reports the actual probe detail without inventing readiness', () => {
    expect(probeSummary(undefined)).toBe('等待检测')
    expect(probeSummary({ kind: 'error', detail: '检测失败：权限不足' })).toBe(
      '检测失败：权限不足',
    )
  })

  it('leaves status command and quota location separate from the primary row', () => {
    const jimeng = tool('jimeng')
    expect(jimeng.statusArgs.trim()).toBe('')
    expect(jimeng.quotaWhere.length).toBeGreaterThan(10)
  })
})

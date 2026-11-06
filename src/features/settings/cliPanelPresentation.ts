import type { CliTool } from '../../domain/shared/cliTools'

export type CliProbeKind = 'checking' | 'found' | 'missing' | 'error' | 'unavailable'

export interface CliProbe {
  kind: CliProbeKind
  detail: string
}

export interface CliPrimaryAction {
  kind:
    | 'checking'
    | 'retry'
    | 'install'
    | 'install-help'
    | 'login'
    | 'key'
    | 'ready'
    | 'unavailable'
  label: string
  opensDetails: boolean
}

export function primaryCliAction(
  tool: CliTool,
  probe: CliProbe | undefined,
): CliPrimaryAction {
  if (!probe || probe.kind === 'checking') {
    return { kind: 'checking', label: '检测中…', opensDetails: false }
  }
  if (probe.kind === 'unavailable') {
    return { kind: 'unavailable', label: '桌面应用可用', opensDetails: false }
  }
  if (probe.kind === 'error') {
    return { kind: 'retry', label: '重新检测', opensDetails: false }
  }
  if (probe.kind === 'missing') {
    return tool.installCommand.trim()
      ? { kind: 'install', label: '安装 CLI', opensDetails: false }
      : { kind: 'install-help', label: '查看安装方式', opensDetails: true }
  }
  if (tool.keyLoginKind === 'config') {
    return { kind: 'key', label: '填写 API Key', opensDetails: true }
  }
  if (tool.loginArgs.trim()) {
    return { kind: 'login', label: '登录', opensDetails: false }
  }
  if (tool.keyLoginKind === 'stdin') {
    return { kind: 'key', label: '填写 API Key', opensDetails: true }
  }
  if (tool.keyLoginKind === '') {
    return { kind: 'login', label: '登录', opensDetails: false }
  }
  return { kind: 'ready', label: '已安装', opensDetails: false }
}

export function probeSummary(probe: CliProbe | undefined): string {
  if (!probe) return '等待检测'
  return probe.detail
}

export function runDiagnosticLabel(confirming: boolean): string {
  return confirming ? '确认运行（可能计费）' : '运行参数模板'
}

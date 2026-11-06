import { protocolLabel } from '../../../domain/project/channel'
import {
  protocolById,
  type ProtocolCatalog,
} from '../../../domain/project/protocol'
import type { NoticeTone } from '../../../domain/ui/notice'

interface ActionState {
  status: 'idle' | 'checking' | 'ok' | 'error'
  message?: string
  latency?: number
  modelCount?: number
  protocol?: string | null
}

export interface SettingsStatusInput {
  action: 'verify' | 'models' | 'detect' | null
  verifiedFor: { protocol: string } | null
  verify: ActionState
  modelsResult: ActionState
  detect: ActionState
  catalog: ProtocolCatalog
  hasLocalCli: boolean
}

/**
 * 状态行文案：验证地址、验证协议和拉取模型回答的是三个不同问题，不能共用
 * 一句“验证通过”。CLI 族探的是本机命令；浏览器中的同一协议仍走网关地址。
 * 判断这次走哪条路必须同时看桌面能力和协议族，否则会把网关成功误报成
 * “本机命令就绪”。语气只跟随本次动作的真实错误态，不把 checking 当失败。
 */
export function settingsStatusPresentation(input: SettingsStatusInput): {
  line: string | null
  tone: NoticeTone
  showMockNote: boolean
} {
  const { action, verifiedFor, verify, modelsResult, detect, catalog, hasLocalCli } = input
  const showMockNote =
    action === 'verify' && verify.status === 'ok' && verifiedFor?.protocol === 'mock'
  if (!action) return { line: null, tone: 'info', showMockNote }
  if (action === 'detect') {
    if (detect.status === 'checking') {
      return { line: '正在探测协议…', tone: 'info', showMockNote }
    }
    if (detect.status === 'ok' && detect.protocol) {
      return {
        line: `✓ 已识别协议 · ${protocolLabel(detect.protocol, catalog)}`,
        tone: 'info',
        showMockNote,
      }
    }
    if (detect.status === 'error') {
      return {
        line: `✗ 未识别出协议 · ${detect.message ?? '所有候选协议均未通过'}`,
        tone: 'error',
        showMockNote,
      }
    }
    return { line: null, tone: 'info', showMockNote }
  }
  const label = protocolLabel(verifiedFor?.protocol ?? '', catalog)
  if (action === 'models') {
    if (modelsResult.status === 'checking') {
      return { line: '正在拉取模型…', tone: 'info', showMockNote }
    }
    if (modelsResult.status === 'ok') {
      return {
        line: `✓ 已拉取模型 · ${label} · 发现 ${modelsResult.modelCount ?? 0} 个模型`,
        tone: 'info',
        showMockNote,
      }
    }
    if (modelsResult.status === 'error') {
      return {
        line: `✗ 拉取失败 · ${modelsResult.message ?? '未知错误'}`,
        tone: 'error',
        showMockNote,
      }
    }
    return { line: null, tone: 'info', showMockNote }
  }
  const isCli =
    hasLocalCli && verifiedFor
      ? protocolById(verifiedFor.protocol, catalog)?.family === 'cli-gateway'
      : false
  if (verify.status === 'checking') {
    return {
      line: isCli ? '正在检查本机命令…' : '正在验证地址…',
      tone: 'info',
      showMockNote,
    }
  }
  if (verify.status === 'ok') {
    return {
      line: `${isCli ? '✓ 本机命令就绪' : '✓ 地址可达'} · ${label}${typeof verify.latency === 'number' ? ` · ${verify.latency}ms` : ''}`,
      tone: 'info',
      showMockNote,
    }
  }
  if (verify.status === 'error') {
    return {
      line: `✗ ${verify.message ?? (isCli ? '本机命令有问题' : '地址不可达')}`,
      tone: 'error',
      showMockNote,
    }
  }
  return { line: null, tone: 'info', showMockNote }
}

import {
  cliModelId,
  type GenerationSource,
  type SourcePick,
} from '../../../../domain/canvas/model/generationSource'
import { capabilityLabel, CLI_PROTOCOL_TOOL, type CliCapability, type CliTool } from '../../../../domain/shared/cliTools'
import { workflowSubmitList } from './creationWorkflowMode'
import { workflowEntryModelId, type WorkflowSourceRow } from './workflowPanelSources'

/**
 * 模型菜单「API · 工作流 · CLI」三个标签的数据（对账 #1133，设计稿 work/source-mock）。
 *
 * 纯函数：只把面板手上的三份来源投影成「标签 → 分组 → 行」，不渲染、不读库；
 * 每一行带好「点了要切成什么」（`SourcePick`），菜单组件只管画和转发。
 */

export type CliToolStatus = 'checking' | 'ok' | 'missing'

export interface CliPanelTool {
  tool: CliTool
  status: CliToolStatus
}

export interface CliPanelSources {
  /** 桌面壳才有子进程能力；网页版 CLI 标签锁住 */
  desktop: boolean
  tools: CliPanelTool[]
}

export type SourceMenuIcon =
  | { kind: 'model'; name: string }
  | { kind: 'channel'; protocol: string }

export interface SourceMenuRow {
  /** 行的稳定值（测试锚点 `data-source-option`） */
  value: string
  label: string
  hint: string
  icon: SourceMenuIcon
  status?: CliToolStatus
  disabled?: boolean
  title?: string
  pick: SourcePick
}

export interface SourceMenuGroup {
  label: string
  rows: SourceMenuRow[]
}

export type SourceSettingsAction = 'channels' | 'workflows' | 'cli'

export interface SourceMenuTab {
  source: GenerationSource
  label: string
  count: number
  /** 锁住的原因（网页版 CLI）；锁住的标签点不开 */
  locked?: string
  groups: SourceMenuGroup[]
  empty: string
  settings: { label: string; action: SourceSettingsAction }
}

export interface ApiModelOption {
  name: string
  /** 能提供它的渠道（选路结果）；没有渠道提供时为空 */
  channelId: string
  channelName: string
}

export interface SourceMenuInput {
  apiModels: readonly ApiModelOption[]
  workflowRows: readonly WorkflowSourceRow[]
  /** 渠道 id → 国内站 / 国际站（只有 RunningHub 两站之分） */
  siteOf: (channelId: string) => string
  cli: CliPanelSources | null
  /** 节点要的类别：CLI 工具报不出这一类时那一行置灰 */
  wantedCategory: CliCapability
  /** 当前工作流条目的实例规格（只用来写副标题 24G / 48G） */
  currentModel: string
  currentInstance: 'default' | 'plus'
}

const STATUS_TEXT: Record<CliToolStatus, string> = { checking: '检测中', ok: '可用', missing: '未检测到' }

export function cliStatusText(status: CliToolStatus): string {
  return STATUS_TEXT[status]
}

/** 只给它报得出的类别（Codex / Gemini 只能对话）；不另写一份能力表 */
export function cliCapabilityText(tool: CliTool): string {
  const caps = [...new Set(tool.models.map((model) => model.category))]
  return caps.map(capabilityLabel).join(' / ') || '无'
}

export function cliProtocolOf(toolId: string): string {
  return Object.entries(CLI_PROTOCOL_TOOL).find(([, tool]) => tool === toolId)?.[0] ?? ''
}

function apiTab(input: SourceMenuInput): SourceMenuTab {
  /**
   * 平铺、按全局模型名去重，**不按渠道分组、不写渠道名**：同一模型可由多个渠道提供，
   * 跑的时候按全局路由选渠道（#1133 目检）。顺序跟全局模型清单一致；没有渠道提供的放末尾。
   * `pick.channelId` 留空：选哪条渠道由面板按路由补（与改动前单列下拉同一口径）。
   */
  const provided = new Map<string, boolean>()
  for (const option of input.apiModels) provided.set(option.name, (provided.get(option.name) ?? false) || Boolean(option.channelId))
  const rowOf = (name: string, ok: boolean): SourceMenuRow => ({
    value: `api::${name}`,
    label: name,
    hint: ok ? '' : '还没有渠道提供',
    icon: { kind: 'model', name },
    pick: { source: 'api', model: name, channelId: '' },
  })
  const names = [...provided.keys()]
  const ready = names.filter((name) => provided.get(name)).map((name) => rowOf(name, true))
  const missing = names.filter((name) => !provided.get(name)).map((name) => rowOf(name, false))
  return {
    source: 'api',
    label: 'API',
    count: names.length,
    groups: [
      ...(ready.length ? [{ label: '', rows: ready }] : []),
      ...(missing.length ? [{ label: '未配置', rows: missing }] : []),
    ],
    empty: '还没有可用的 API 模型：先去渠道设置里配好 Key 并勾选模型。',
    settings: { label: '渠道设置', action: 'channels' },
  }
}

function workflowTab(input: SourceMenuInput): SourceMenuTab {
  const rowOf = (row: WorkflowSourceRow): SourceMenuRow => {
    const model = workflowEntryModelId(row.entry)
    const params = row.entry.fields.filter((field) => field.enabled).length
    const instance = row.entry.kind === 'app' ? '' : model === input.currentModel && input.currentInstance === 'plus' ? '48G' : '24G'
    return {
      value: `${row.channelId}::${model}`,
      label: row.entry.title,
      hint: [input.siteOf(row.channelId), `${params} 个参数`, instance].filter(Boolean).join(' · '),
      icon: { kind: 'channel', protocol: row.protocol },
      pick: {
        source: 'workflow',
        model,
        channelId: row.channelId,
        defaults: {
          workflowNodeInfoList: workflowSubmitList(row.entry, {}),
          ...(row.entry.provider === 'comfyui-local' && row.entry.workflowJson ? { workflowJson: row.entry.workflowJson } : {}),
          workflowInstance: 'default',
          ...(row.entry.mediaPolicy ? { workflowMediaPolicy: row.entry.mediaPolicy } : {}),
          ...(row.entry.mediaPolicy === 'prune-workflow' ? { workflowOptionalMediaIds: row.entry.fields.filter((field) => !field.required && ['image', 'video', 'audio'].includes(field.type)).map((field) => field.id) } : {}),
        },
      },
    }
  }
  const apps = input.workflowRows.filter((row) => row.entry.kind === 'app').map(rowOf)
  const flows = input.workflowRows.filter((row) => row.entry.kind !== 'app').map(rowOf)
  return {
    source: 'workflow',
    label: '工作流',
    count: apps.length + flows.length,
    groups: [
      ...(apps.length ? [{ label: 'AI 应用', rows: apps }] : []),
      ...(flows.length ? [{ label: '', rows: flows }] : []),
    ],
    empty: '还没有导入 AI 应用或工作流：去管理页贴一个 RunningHub 链接就能导入。',
    settings: { label: '工作流设置', action: 'workflows' },
  }
}

function cliTab(input: SourceMenuInput): SourceMenuTab {
  const cli = input.cli
  const rows: SourceMenuRow[] = (cli?.tools ?? []).map(({ tool, status }) => {
    const able = tool.models.some((model) => model.category === input.wantedCategory)
    const id = cliModelId(tool.id)
    return {
      value: `cli::${tool.id}`,
      label: tool.name,
      hint: `本机账号额度 · ${cliCapabilityText(tool)}`,
      icon: { kind: 'channel', protocol: cliProtocolOf(tool.id) },
      status,
      ...(able ? {} : { disabled: true, title: `「${tool.name}」不能${capabilityLabel(input.wantedCategory)}` }),
      pick: { source: 'cli', model: id, channelId: id },
    }
  })
  return {
    source: 'cli',
    label: 'CLI',
    count: rows.length,
    ...(cli?.desktop ? {} : { locked: '本机 CLI 需要桌面版：网页版没有起本机命令的能力' }),
    groups: rows.length ? [{ label: '', rows }] : [],
    empty: '还没有本机 CLI 工具：去本机 CLI 设置里装好并登录。',
    settings: { label: 'CLI 设置', action: 'cli' },
  }
}

export function buildSourceMenu(input: SourceMenuInput): SourceMenuTab[] {
  return [apiTab(input), workflowTab(input), cliTab(input)]
}

import type { Channel } from '../../../domain/project/channel'
import type { RunRequest } from '../../../domain/shared/execution/types'
import { CLI_PROTOCOL_TOOL, modelCapabilitiesOf, type CliCapability, type CliTool } from '../../../domain/shared/cliTools'
import { toolIdOfCliModel } from '../../../domain/canvas/model/generationSource'
import type { CliPort, StoragePort } from '../../../platform/ports'
import { createCliToolStore } from '../../../state/project/cliToolStore'

/**
 * 「本机 CLI」来源的执行前检查与选路（对账 #1133 逻辑 4）。
 *
 * 节点模型是 `cli:<toolId>`：它**不经渠道表选路**（用户在「全局设置 → CLI」配的是工具，
 * 不是渠道），而是在这里合成一条 `cli:<toolId>` 的渠道视图（协议 = 该工具对应的 CLI 协议），
 * 交给原有的适配器工厂 —— 桌面壳里就是 `cliRun.ts`，真的起子进程、把产物读回来，
 * 产物与其它渠道一样由执行引擎落回节点。
 *
 * 拦截（都在发出任何命令之前，给一句能照着改的话）：
 * - 网页版没有子进程能力；
 * - 工具不在目录里；
 * - 工具报不出这一类（Codex 只能对话，不能出图）；
 * - 本机找不到命令（`which` 为空）。
 *
 * ⚠️ 登录态**不在这里判**：各家 CLI 没有统一的「是否已登录」探测（`statusArgs` 只回原话），
 * 未登录会在真正运行时由 CLI 自己报错，经 `cliRun` 的错误归一显示出来。
 */
export interface CliRouteDeps {
  hasLocalCli: boolean
  loadTools: () => Promise<readonly CliTool[]>
  which: (program: string) => Promise<string | null>
}

/** 执行宿主的平台 → 检查要的三样（工具表现读「全局设置 → CLI」那一行，改完下一次生成就生效） */
export function cliRouteDepsOf(platform: { cli?: Pick<CliPort, 'which'> | null; storage: StoragePort }): CliRouteDeps {
  const cli = platform.cli ?? null
  return {
    hasLocalCli: cli !== null,
    loadTools: () => createCliToolStore(platform.storage).load(),
    which: (program) => (cli ? cli.which(program).catch(() => null) : Promise.resolve(null)),
  }
}

export interface CliRouteFailure {
  taskId: string
  nodeId: string
  message: string
}

export interface CliRouteResult {
  /** 合成出来的渠道视图：id = `cli:<toolId>` */
  channels: Map<string, Channel>
  failures: CliRouteFailure[]
}

const PROTOCOL_OF_TOOL: Record<string, string> = Object.fromEntries(
  Object.entries(CLI_PROTOCOL_TOOL).map(([protocol, tool]) => [tool, protocol]),
)

export function cliCategoryOfKind(kind: RunRequest['kind']): CliCapability {
  return kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'chat'
}

const CATEGORY_TEXT: Record<CliCapability, string> = { image: '出图', video: '出视频', chat: '对话' }

/** 合成的 CLI 渠道视图：只给适配器工厂与执行引擎看，不进渠道表 */
export function cliChannelFor(tool: CliTool, protocol: string): Channel {
  return {
    id: `cli:${tool.id}`,
    name: `本机 CLI · ${tool.name}`,
    icon: null,
    protocol,
    baseUrl: '',
    credentialRef: null,
    tokenTail: null,
    hasToken: false,
    altCredentialRef: null,
    altTokenTail: null,
    hasAltToken: false,
    credentialGroups: [],
    enabled: true,
    models: modelCapabilitiesOf(tool),
    modelCache: [],
    modelMap: {},
    priority: 0,
    weight: 0,
    routeStrategy: 'priority',
    order: 0,
    lastTestAt: null,
    lastTestLatency: null,
    createdAt: 0,
  }
}

export function isCliTaskModel(model: string): boolean {
  return toolIdOfCliModel(model) !== null
}

/**
 * 把计划里 `cli:` 任务就地改写成「合成渠道 + 工具模型」，并收集拦截原因。
 * 没有 `cli:` 任务时不读工具表、不跑 `which`。
 */
export async function routeCliTasks(
  tasks: readonly { id: string; nodeId: string; request: RunRequest }[],
  deps: CliRouteDeps,
): Promise<CliRouteResult> {
  const channels = new Map<string, Channel>()
  const failures: CliRouteFailure[] = []
  const cliTasks = tasks.filter((task) => isCliTaskModel(task.request.model))
  if (cliTasks.length === 0) return { channels, failures }
  const fail = (task: (typeof cliTasks)[number], message: string) =>
    failures.push({ taskId: task.id, nodeId: task.nodeId, message })
  if (!deps.hasLocalCli) {
    for (const task of cliTasks) {
      fail(task, '本机 CLI 只能在桌面版里运行：网页版没有起本机命令的能力，请换成 API / 工作流来源，或在桌面版里生成')
    }
    return { channels, failures }
  }
  const tools = await deps.loadTools()
  const found = new Map<string, boolean>()
  for (const task of cliTasks) {
    const toolId = toolIdOfCliModel(task.request.model) ?? ''
    const tool = tools.find((item) => item.id === toolId)
    const protocol = PROTOCOL_OF_TOOL[toolId]
    if (!tool || !protocol) {
      fail(task, `找不到本机 CLI 工具「${toolId}」：它可能已从目录移除，请在模型菜单的 CLI 标签里重新选一个`)
      continue
    }
    const category = cliCategoryOfKind(task.request.kind)
    const model = tool.models.find((item) => item.category === category)
    if (!model) {
      const can = [...new Set(tool.models.map((item) => CATEGORY_TEXT[item.category]))].join(' / ') || '无'
      fail(task, `「${tool.name}」的本机 CLI 不能${CATEGORY_TEXT[category]}（它能：${can}），请换一个工具或换回 API 来源`)
      continue
    }
    if (!found.has(tool.program)) found.set(tool.program, (await deps.which(tool.program)) !== null)
    if (!found.get(tool.program)) {
      fail(task, `本机未检测到「${tool.name}」的命令「${tool.program}」：去「全局设置 → 本机 CLI」安装或改命令名后再生成`)
      continue
    }
    const channel = channels.get(`cli:${tool.id}`) ?? cliChannelFor(tool, protocol)
    channels.set(channel.id, channel)
    task.request = { ...task.request, channelId: channel.id, model: model.id } as RunRequest
  }
  return { channels, failures }
}

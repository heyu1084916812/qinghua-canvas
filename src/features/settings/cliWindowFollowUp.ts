import { buildArgs, type CliTool } from '../../domain/shared/cliTools'

export type CliWindowFlow = 'install' | 'installOnly' | 'login'

export type CliWindowAction = 'login' | 'none' | 'status'

export interface CliWindowFollowUp {
  action: CliWindowAction
  statusArgs: string[] | null
  message: string
}

function exitSuffix(exitCode: number | null): string {
  return exitCode === null || exitCode === 0 ? '' : `（退出码 ${exitCode}）`
}

/** 可见窗口结束后只做一次确定动作：安装后继续登录，登录后查状态，不要求用户再点。 */
export function cliWindowFollowUp(
  flow: CliWindowFlow,
  tool: CliTool,
  found: boolean | null,
  exitCode: number | null,
): CliWindowFollowUp {
  const suffix = exitSuffix(exitCode)
  if (flow === 'install' || flow === 'installOnly') {
    if (found) {
      return {
        action: flow === 'install' ? 'login' : 'none',
        statusArgs: null,
        message:
          flow === 'install'
            ? `安装窗口已结束${suffix}，已重新检测到「${tool.program}」，正在继续登录。`
            : `安装窗口已结束${suffix}，已重新检测到「${tool.program}」。`,
      }
    }
    return {
      action: 'none',
      statusArgs: null,
      message:
        `安装窗口已结束${suffix}，仍未检测到「${tool.program}」。` +
        '请查看安装窗口输出，或手动检查命令名与安装命令。',
    }
  }

  const statusArgs = tool.statusArgs.trim() ? buildArgs(tool.statusArgs, {}) : null
  return statusArgs
    ? {
        action: 'status',
        statusArgs,
        message: `登录窗口已结束${suffix}，正在自动查询状态。`,
      }
    : {
        action: 'none',
        statusArgs: null,
        message: `登录窗口已结束${suffix}；这个工具没有配置状态命令，无法自动确认登录态。`,
      }
}

import { buildArgs, type CliTool } from '../../domain/shared/cliTools'

export interface CliKeyLoginResult {
  statusArgs: string[] | null
  message: string
}

/** 配置型密钥登录后的状态命令与反馈保持同一判断。 */
export function cliKeyLoginResult(tool: CliTool, writtenPath: string): CliKeyLoginResult {
  const statusArgs = tool.statusArgs.trim() ? buildArgs(tool.statusArgs, {}) : null
  return {
    statusArgs,
    message:
      `Key 已写入 ${writtenPath}（与手敲 \`rh auth set-key\` 等效，密钥没有进命令行）。` +
      (statusArgs ? '下面立刻查一次状态。' : '这个工具没有配置状态命令，已跳过自动查询。'),
  }
}

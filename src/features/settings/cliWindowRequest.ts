import type { CliTool } from '../../domain/shared/cliTools'
import type { CliWindowRequest } from '../../platform/ports'

/** 可见 CLI 窗口统一携带工具工作目录，登录、安装和状态窗口不能各写一套。 */
export function cliWindowRequest(
  tool: CliTool,
  program: string,
  args: readonly string[],
): CliWindowRequest {
  const cwd = tool.cwd.trim()
  return {
    program,
    args: [...args],
    ...(cwd ? { cwd } : {}),
  }
}

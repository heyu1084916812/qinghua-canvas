import { useEffect, useState } from 'react'
import { usePlatformOptional } from '../../../../app/providers/PlatformProvider'
import { createCliToolStore } from '../../../../state/project/cliToolStore'
import type { CliPanelSources } from './sourceMenuModel'

/**
 * 模型菜单 CLI 标签的数据：本机 CLI 工具表（「全局设置 → CLI」那一行）+ 每个命令在不在（对账 #1133）。
 *
 * - 网页版（没有 `CliPort`）：`desktop: false`，标签锁住，不探测；
 * - 桌面版：菜单**打开时**才探测（`active`），每次打开重测一次 —— 用户装完命令回来不用重启；
 * - 「未登录」不在这里判：各家 CLI 没有统一的登录态探测（`statusArgs` 只回原话），
 *   编一个状态比不显示更糟；未登录由真正运行时 CLI 自己报错。
 */
export function useCliPanelSources(active: boolean): CliPanelSources | null {
  const platform = usePlatformOptional()
  const [sources, setSources] = useState<CliPanelSources | null>(null)
  useEffect(() => {
    if (!platform || !active) return
    let alive = true
    const cli = platform.cli ?? null
    void createCliToolStore(platform.storage).load().then(async (tools) => {
      if (!alive) return
      if (!cli) {
        setSources({ desktop: false, tools: tools.map((tool) => ({ tool, status: 'missing' as const })) })
        return
      }
      setSources({ desktop: true, tools: tools.map((tool) => ({ tool, status: 'checking' as const })) })
      const checked = await Promise.all(
        tools.map(async (tool) => ({
          tool,
          status: (await cli.which(tool.program).catch(() => null)) ? ('ok' as const) : ('missing' as const),
        })),
      )
      if (alive) setSources({ desktop: true, tools: checked })
    })
    return () => {
      alive = false
    }
  }, [platform, active])
  return sources
}

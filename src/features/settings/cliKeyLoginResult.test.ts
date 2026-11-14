import { describe, expect, it } from 'vitest'
import { defaultCliTools, type CliTool } from '../../domain/shared/cliTools'
import { cliKeyLoginResult } from './cliKeyLoginResult'

/**
 * `keyLoginKind: 'config'` 这条落点的测试夹具。
 *
 * 曾经借 RunningHub 那条工具当夹具；它 2026-11-14 已删除（#1114），
 * 但**机制还在**（壳写工具自己的配置文件），所以夹具改成显式构造 ——
 * 别再让"某个真实工具存在"成为机制测试的前提。
 */
const configTool: CliTool = {
  ...defaultCliTools()[0]!,
  id: 'config-fixture',
  name: 'Config Fixture',
  keyLoginKind: 'config',
  statusArgs: '--json check',
}

describe('cliKeyLoginResult', () => {
  it('runs status only when a real status command is configured', () => {
    const result = cliKeyLoginResult(
      { ...configTool, statusArgs: 'check --json' },
      'C:\\Users\\me\\AppData\\Roaming\\rh\\config.toml',
    )
    expect(result.statusArgs).toEqual(['check', '--json'])
    expect(result.message).toContain('下面立刻查一次状态。')
  })

  it('skips an empty status command instead of running the tool itself', () => {
    const result = cliKeyLoginResult(
      { ...configTool, statusArgs: '   ' },
      'C:\\Users\\me\\AppData\\Roaming\\rh\\config.toml',
    )
    expect(result.statusArgs).toBeNull()
    expect(result.message).toContain('没有配置状态命令，已跳过自动查询。')
  })
})

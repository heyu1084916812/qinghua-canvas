import { describe, expect, it } from 'vitest'
import { defaultCliTools } from '../../domain/shared/cliTools'
import { cliKeyLoginResult } from './cliKeyLoginResult'

const runningHub = defaultCliTools().find((tool) => tool.id === 'runninghub')!

describe('cliKeyLoginResult', () => {
  it('runs status only when a real status command is configured', () => {
    const result = cliKeyLoginResult(
      { ...runningHub, statusArgs: 'check --json' },
      'C:\\Users\\me\\AppData\\Roaming\\rh\\config.toml',
    )
    expect(result.statusArgs).toEqual(['check', '--json'])
    expect(result.message).toContain('下面立刻查一次状态。')
  })

  it('skips an empty status command instead of running the tool itself', () => {
    const result = cliKeyLoginResult(
      { ...runningHub, statusArgs: '   ' },
      'C:\\Users\\me\\AppData\\Roaming\\rh\\config.toml',
    )
    expect(result.statusArgs).toBeNull()
    expect(result.message).toContain('没有配置状态命令，已跳过自动查询。')
  })
})

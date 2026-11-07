import { describe, expect, it } from 'vitest'
import { defaultCliTools } from '../../domain/shared/cliTools'
import { cliWindowFollowUp } from './cliWindowFollowUp'

const runningHub = defaultCliTools().find((tool) => tool.id === 'runninghub')!

describe('cliWindowFollowUp', () => {
  it('continues directly to login after a successful install window, without another click', () => {
    const result = cliWindowFollowUp('install', runningHub, true, 0)
    expect(result.action).toBe('login')
    expect(result.message).toContain('正在继续登录')
  })

  it('does not reopen an install window when the command is still missing', () => {
    const result = cliWindowFollowUp('install', runningHub, false, 1)
    expect(result).toMatchObject({ action: 'none', statusArgs: null })
    expect(result.message).toContain('退出码 1')
    expect(result.message).toContain('仍未检测到')
  })

  it('auto-runs a configured status command after the login window closes', () => {
    const result = cliWindowFollowUp(
      'login',
      { ...runningHub, statusArgs: 'check --json' },
      null,
      0,
    )
    expect(result.action).toBe('status')
    expect(result.statusArgs).toEqual(['check', '--json'])
    expect(result.message).toContain('正在自动查询状态')
  })

  it('does not invent a status command when the tool has none', () => {
    const result = cliWindowFollowUp('login', { ...runningHub, statusArgs: '   ' }, null, 0)
    expect(result).toMatchObject({ action: 'none', statusArgs: null })
    expect(result.message).toContain('无法自动确认登录态')
  })
})

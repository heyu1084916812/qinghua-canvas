import { describe, expect, it } from 'vitest'
import { defaultCliTools } from '../../domain/shared/cliTools'
import { cliWindowRequest } from './cliWindowRequest'

const tool = defaultCliTools().find((item) => item.id === 'codex')!

describe('cliWindowRequest', () => {
  it('passes the configured cwd to login and install windows', () => {
    expect(
      cliWindowRequest({ ...tool, cwd: ' E:/workspace/current ' }, 'codex', ['login']),
    ).toEqual({
      program: 'codex',
      args: ['login'],
      cwd: 'E:/workspace/current',
    })
    expect(
      cliWindowRequest({ ...tool, cwd: ' E:/workspace/current ' }, 'npm', ['install', '-g', '@openai/codex']),
    ).toEqual({
      program: 'npm',
      args: ['install', '-g', '@openai/codex'],
      cwd: 'E:/workspace/current',
    })
  })

  it('omits empty cwd so the window inherits the app directory', () => {
    expect(cliWindowRequest({ ...tool, cwd: '   ' }, 'codex', [])).toEqual({
      program: 'codex',
      args: [],
    })
  })
})

import { describe, expect, it } from 'vitest'
import { settingsStatusPresentation } from './settingsStatusPresentation'

const catalog = {
  all: [
    {
      id: 'openai-compatible',
      name: 'OpenAI 兼容',
      short: 'OpenAI',
      family: 'openai',
      kind: 'public',
      status: 'ready',
    },
    {
      id: 'cli-gateway',
      name: 'CLI 网关',
      short: 'CLI',
      family: 'cli-gateway',
      kind: 'station',
      status: 'ready',
    },
  ],
} as never
const idle = { status: 'idle' as const }

describe('设置页状态文案', () => {
  it('验证、拉模型和协议探测保留原分支与语气', () => {
    expect(
      settingsStatusPresentation({
        action: 'verify',
        verifiedFor: { protocol: 'openai-compatible' },
        verify: { status: 'ok', latency: 42 },
        modelsResult: idle,
        detect: idle,
        catalog,
        hasLocalCli: false,
      }),
    ).toEqual({
      line: '✓ 地址可达 · OpenAI 兼容 · 42ms',
      tone: 'info',
      showMockNote: false,
    })
    expect(
      settingsStatusPresentation({
        action: 'models',
        verifiedFor: { protocol: 'openai-compatible' },
        verify: idle,
        modelsResult: { status: 'error', message: '超时' },
        detect: idle,
        catalog,
        hasLocalCli: false,
      }),
    ).toEqual({
      line: '✗ 拉取失败 · 超时',
      tone: 'error',
      showMockNote: false,
    })
    expect(
      settingsStatusPresentation({
        action: 'detect',
        verifiedFor: null,
        verify: idle,
        modelsResult: idle,
        detect: { status: 'error', message: '均未通过' },
        catalog,
        hasLocalCli: false,
      }),
    ).toEqual({
      line: '✗ 未识别出协议 · 均未通过',
      tone: 'error',
      showMockNote: false,
    })
  })

  it('CLI 判定同时看桌面能力与协议族，mock 提示独立返回', () => {
    expect(
      settingsStatusPresentation({
        action: 'verify',
        verifiedFor: { protocol: 'cli-gateway' },
        verify: { status: 'checking' },
        modelsResult: idle,
        detect: idle,
        catalog,
        hasLocalCli: true,
      }).line,
    ).toBe('正在检查本机命令…')
    expect(
      settingsStatusPresentation({
        action: 'verify',
        verifiedFor: { protocol: 'mock' },
        verify: { status: 'ok' },
        modelsResult: idle,
        detect: idle,
        catalog,
        hasLocalCli: false,
      }).showMockNote,
    ).toBe(true)
  })
})

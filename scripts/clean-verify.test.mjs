import { describe, expect, it } from 'vitest'
import { isRootTempFile, parseArgs, selectCleanTargets } from './clean-verify.mjs'

describe('clean-verify', () => {
  it('identifies only local temp/probe/tauri/devserver files at repo root', () => {
    expect(isRootTempFile('.tmp-agent-1440.png')).toBe(true)
    expect(isRootTempFile('.probe-g158.txt')).toBe(true)
    expect(isRootTempFile('.tauri-dev.log')).toBe(true)
    expect(isRootTempFile('.devserver.log')).toBe(true)
    expect(isRootTempFile('.gitignore')).toBe(false)
    expect(isRootTempFile('.env')).toBe(false)
    expect(isRootTempFile('README.md')).toBe(false)
  })

  it('respects keep whitelist and maxAgeDays when selecting targets', () => {
    const now = Date.UTC(2026, 10, 27)
    const day = 24 * 60 * 60 * 1000
    const entries = [
      { name: 'agent-e2e-20261127', mtimeMs: now - 1 * day },
      { name: 'recent-run', mtimeMs: now - 2 * day },
      { name: 'old-profile', mtimeMs: now - 10 * day },
    ]

    expect(selectCleanTargets(entries, { keep: ['agent-e2e-20261127'], nowMs: now })).toEqual([
      'old-profile',
      'recent-run',
    ])
    expect(selectCleanTargets(entries, { keep: ['agent-e2e-20261127'], maxAgeDays: 7, nowMs: now })).toEqual([
      'old-profile',
    ])
  })

  it('parses CLI flags cleanly', () => {
    expect(parseArgs(['--dry-run', '--keep=a,b', '--keep=c', '--days=14'])).toEqual({
      dryRun: true,
      maxAgeDays: 14,
      keep: ['a', 'b', 'c'],
    })
  })
})

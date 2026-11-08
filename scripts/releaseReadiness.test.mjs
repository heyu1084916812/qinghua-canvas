import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  fileURLToPath(new URL('../scripts/check-release-readiness.mjs', import.meta.url)),
  'utf8',
)

describe('release readiness report', () => {
  it('is a read-only report and never performs publishing actions', () => {
    expect(source).toContain('不 push、不打 tag、不创建 Release')
    expect(source).not.toMatch(/spawnSync\('git',\s*\['push'/)
    expect(source).not.toMatch(/gh\s+release/)
  })

  it('reports versioned assets, signatures, license and external conditions', () => {
    for (const token of [
      'pendingCommits',
      'sha256',
      'updaterSignatureMatches',
      'authenticodeSigned',
      'licensePresent',
      'externalConditions',
      'confirmationMatches',
      'blockers: externalConditions',
    ]) {
      expect(source).toContain(token)
    }
  })

  it('does not let a stale confirmation file silently pass', () => {
    expect(source).toContain('confirmationPresent: assets.confirmation.exists && confirmationMatches')
    expect(source).toContain('未经明确确认不得执行')
  })
})

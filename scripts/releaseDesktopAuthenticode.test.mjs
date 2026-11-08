import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  fileURLToPath(new URL('../scripts/release-desktop.mjs', import.meta.url)),
  'utf8',
)

describe('Windows Authenticode release support', () => {
  it('keeps updater signature and Authenticode as separate concepts', () => {
    expect(source).toContain('Ed25519 `.sig` 不是 Windows Authenticode')
    expect(source).toContain('QH_SIGNTOOL')
    expect(source).toContain('QH_SIGNTOOL_SUBJECT')
    expect(source).toContain('QH_SIGNTOOL_THUMBPRINT')
    expect(source).toContain('signAuthenticode(path.join(outDir, asset))')
  })

  it('does not fail unsigned local builds when no certificate is configured', () => {
    expect(source).toContain('Windows Authenticode 保持未签名')
    expect(source).toContain('return false')
  })
})

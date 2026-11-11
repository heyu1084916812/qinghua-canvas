import { describe, expect, it } from 'vitest'
import { createTauriCredentialsWith, type TauriCredentialDeps } from './tauriCredentials'

function setup(options: { sealFails?: boolean } = {}) {
  const kv = new Map<string, unknown>()
  const legacyStore = new Map<string, string>()
  const deps: TauriCredentialDeps = {
    seal: async (plain) => {
      if (options.sealFails) throw new Error('unsupported')
      return `SEALED(${btoa(plain)})`
    },
    unseal: async (sealed) => atob(sealed.slice('SEALED('.length, -1)),
    kvGet: async (key) => kv.get(key) ?? null,
    kvPut: async (key, value) => {
      kv.set(key, value)
    },
    kvDelete: async (key) => {
      kv.delete(key)
    },
    legacy: {
      load: async (ref) => legacyStore.get(ref) ?? null,
      save: async (ref, secret) => {
        legacyStore.set(ref, secret)
        kv.set(`qinghua.cred.${ref}`, { iv: [1], ciphertext: [2] })
      },
      mask: (secret) => `masked:${secret.length}`,
    },
  }
  return { kv, legacyStore, port: createTauriCredentialsWith(deps) }
}

describe('tauri DPAPI credentials', () => {
  it('stores only the sealed form and reads it back', async () => {
    const { kv, port } = setup()
    await port.save('ch1', 'sk-live-abcdef')
    const raw = JSON.stringify(kv.get('qinghua.cred.ch1'))
    expect(raw).not.toContain('sk-live-abcdef')
    expect(kv.get('qinghua.cred.ch1')).toMatchObject({ v: 2 })
    expect(await port.load('ch1')).toBe('sk-live-abcdef')
  })

  it('migrates a legacy record to the sealed form on first read', async () => {
    const { kv, legacyStore, port } = setup()
    legacyStore.set('old', 'sk-old-key')
    kv.set('qinghua.cred.old', { iv: [1], ciphertext: [2] })
    expect(await port.load('old')).toBe('sk-old-key')
    expect(kv.get('qinghua.cred.old')).toMatchObject({ v: 2 })
    expect(await port.load('old')).toBe('sk-old-key')
  })

  it('falls back to the legacy format when DPAPI is unavailable', async () => {
    const { kv, port } = setup({ sealFails: true })
    await port.save('ch2', 'sk-x')
    expect(kv.get('qinghua.cred.ch2')).toEqual({ iv: [1], ciphertext: [2] })
    expect(await port.load('ch2')).toBe('sk-x')
  })

  it('returns null for missing refs and removes records', async () => {
    const { kv, port } = setup()
    expect(await port.load('none')).toBeNull()
    await port.save('ch3', 'sk-y')
    await port.remove('ch3')
    expect(kv.has('qinghua.cred.ch3')).toBe(false)
  })
})

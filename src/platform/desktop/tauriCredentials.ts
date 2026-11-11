import { invoke } from '@tauri-apps/api/core'
import type { CredentialPort } from '../ports'
import { createSharedCredentials } from '../web/sharedCredentials'
import { sharedKvDelete, sharedKvGet, sharedKvPut } from '../web/sharedStorage'

const REF_PREFIX = 'qinghua.cred.'

/** DPAPI 封装后的凭据记录；`v: 2` 用来和旧的 `{ iv, ciphertext }` 区分。 */
interface SealedCredential {
  v: 2
  dpapi: string
}

function isSealed(value: unknown): value is SealedCredential {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { v?: unknown }).v === 2 &&
    typeof (value as { dpapi?: unknown }).dpapi === 'string'
  )
}

export interface TauriCredentialDeps {
  seal(plain: string): Promise<string>
  unseal(sealed: string): Promise<string>
  kvGet(key: string): Promise<unknown>
  kvPut(key: string, value: unknown): Promise<void>
  kvDelete(key: string): Promise<void>
  /** 旧格式（固定口令 AES-GCM）读取器：只用于一次性迁移。 */
  legacy: Pick<CredentialPort, 'load' | 'save' | 'mask'>
}

/**
 * **桌面壳凭据端口**：API Key 交给 Windows DPAPI 加密（绑定当前 Windows 用户），
 * 共享存储里只留密文。
 *
 * 旧方案的口令写死在前端、盐与密文同库 ⇒ 拿到库就能解出全部 Key。
 * 这里读到旧格式时先用旧方式解开，再立刻以 DPAPI 重新写回（一次性迁移，用户无感）。
 * 壳不支持 DPAPI（非 Windows）时如实退回旧格式，不假装加密成功。
 */
export function createTauriCredentialsWith(deps: TauriCredentialDeps): CredentialPort {
  const save = async (ref: string, secret: string) => {
    let sealed: string
    try {
      sealed = await deps.seal(secret)
    } catch {
      await deps.legacy.save(ref, secret)
      return
    }
    const record: SealedCredential = { v: 2, dpapi: sealed }
    await deps.kvPut(REF_PREFIX + ref, record)
  }

  return {
    save,

    async load(ref) {
      const stored = await deps.kvGet(REF_PREFIX + ref)
      if (stored == null) return null
      if (isSealed(stored)) return deps.unseal(stored.dpapi)
      const plain = await deps.legacy.load(ref)
      if (plain != null) {
        // 迁移失败不影响本次读取：下次读取会再试。
        await save(ref, plain).catch(() => undefined)
      }
      return plain
    },

    async remove(ref) {
      await deps.kvDelete(REF_PREFIX + ref)
    },

    mask: (secret) => deps.legacy.mask(secret),
  }
}

export function createTauriCredentials(): CredentialPort {
  return createTauriCredentialsWith({
    seal: (plain) => invoke<string>('credential_protect', { plain }),
    unseal: (sealed) => invoke<string>('credential_unprotect', { sealed }),
    kvGet: (key) => sharedKvGet(key),
    kvPut: (key, value) => sharedKvPut(key, value),
    kvDelete: (key) => sharedKvDelete(key),
    legacy: createSharedCredentials(),
  })
}

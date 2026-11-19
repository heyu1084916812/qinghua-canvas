import { expect, it, vi } from 'vitest'
import { createSharedCredentials } from './sharedCredentials'
import { sharedKvGet, sharedKvPut } from './sharedStorage'

vi.mock('./sharedStorage', () => ({ sharedKvGet: vi.fn(), sharedKvPut: vi.fn(), sharedKvDelete: vi.fn() }))

it('浏览器遇到桌面凭据时解释原因，不读写盐、不覆盖原记录', async () => {
  vi.mocked(sharedKvGet).mockResolvedValue({ v: 2, dpapi: 'opaque-test-record' })
  await expect(createSharedCredentials().load('example')).rejects.toThrow(/^这个 Key 由桌面应用保存，只能在桌面应用中使用。请打开轻画桌面版后重试。$/)
  expect(sharedKvGet).toHaveBeenCalledExactlyOnceWith('qinghua.cred.example')
  expect(sharedKvPut).not.toHaveBeenCalled()
})

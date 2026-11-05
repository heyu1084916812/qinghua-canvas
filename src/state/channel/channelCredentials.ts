import type { CredentialPort } from '../../platform/ports'
import {
  tokenTailOf,
  type Channel,
  type ChannelCredentialGroup,
  type CredentialSlot,
} from '../../domain/project/channel'
import { createId } from '../../shared/id'

/** Runtime assemblies use this narrow port, not the user-facing Store actions. */
export interface CredentialReadPort {
  load(credentialRef: string): Promise<string | null>
}

export interface CredentialAccessPort extends CredentialReadPort {
  remove(credentialRef: string): Promise<void>
}

export function createCredentialAccess(
  secrets: Pick<CredentialPort, 'load' | 'remove'>,
): CredentialAccessPort {
  return {
    load: (credentialRef) => secrets.load(credentialRef),
    remove: (credentialRef) => secrets.remove(credentialRef),
  }
}

export interface ChannelCredentials {
  loadByRef(credentialRef: string): Promise<string | null>
  removeByRef(credentialRef: string): Promise<void>
  loadKeys(channel: Channel): Promise<{ apiKey: string | null; altApiKey: string | null }>
  saveToken(id: string, token: string, slot?: CredentialSlot): Promise<void>
  loadToken(id: string, slot?: CredentialSlot): Promise<string | null>
  removeToken(id: string, slot?: CredentialSlot): Promise<void>
  hasToken(id: string, slot?: CredentialSlot): Promise<boolean>
  credentialGroupOf(channel: Channel, groupId?: string): ChannelCredentialGroup
  patchCredentialGroup(id: string, groupId: string, patch: Partial<ChannelCredentialGroup>): Promise<void>
  addCredentialGroup(id: string, name?: string): Promise<ChannelCredentialGroup>
  renameCredentialGroup(id: string, groupId: string, name: string): Promise<void>
  setCredentialGroupPriority(id: string, groupId: string, priority: number): Promise<void>
  removeCredentialGroup(id: string, groupId: string): Promise<void>
  saveCredentialGroupToken(id: string, groupId: string, token: string): Promise<void>
  loadCredentialGroupToken(id: string, groupId: string): Promise<string | null>
  removeCredentialGroupToken(id: string, groupId: string): Promise<void>
}

export function createChannelCredentials(
  repo: { get(id: string): Promise<Channel | null> },
  secrets: Pick<CredentialPort, 'save' | 'load' | 'remove'>,
  update: (id: string, patch: Partial<Channel>) => Promise<Channel>,
): ChannelCredentials {
  const access = createCredentialAccess(secrets)
  const loadByRef = access.load

  const slotFields = (channel: Channel, slot: CredentialSlot) =>
    slot === 'alt'
      ? { ref: channel.altCredentialRef, tail: 'altTokenTail' as const, has: 'hasAltToken' as const }
      : { ref: channel.credentialRef, tail: 'tokenTail' as const, has: 'hasToken' as const }

  const byPriority = (a: ChannelCredentialGroup, b: ChannelCredentialGroup) =>
    b.priority - a.priority || a.createdAt - b.createdAt

  const loadKeys = async (channel: Channel) => ({
    apiKey: channel.credentialRef ? await loadByRef(channel.credentialRef) : null,
    altApiKey: channel.altCredentialRef ? await loadByRef(channel.altCredentialRef) : null,
  })

  const patchCredentialGroup = async (
    id: string,
    groupId: string,
    patch: Partial<ChannelCredentialGroup>,
  ) => {
    const channel = await repo.get(id)
    if (!channel) throw new Error(`[channelStore] 渠道不存在：${id}`)
    if (!channel.credentialGroups.some((group) => group.id === groupId)) {
      throw new Error(`[channelStore] Key 分组不存在：${groupId}`)
    }
    await update(id, {
      credentialGroups: channel.credentialGroups.map((group) =>
        group.id === groupId ? { ...group, ...patch, id: group.id } : group,
      ),
    })
  }

  return {
    loadByRef,
    removeByRef: access.remove,
    loadKeys,
    patchCredentialGroup,
    async saveToken(id, token, slot = 'primary') {
      const channel = await repo.get(id)
      const fields = channel ? slotFields(channel, slot) : null
      if (!channel || !fields?.ref) throw new Error(`[channelStore] 渠道无凭据引用：${id}`)
      await secrets.save(fields.ref, token)
      let group = [...channel.credentialGroups].sort(byPriority)[slot === 'alt' ? 1 : 0]
      if (!group && slot === 'alt') {
        group = {
          id: createId('credgroup'),
          name: '备用分组',
          credentialRef: fields.ref,
          tokenTail: null,
          hasToken: false,
          priority: 0,
          models: [],
          modelCache: [],
          createdAt: Date.now(),
        }
        await update(id, { credentialGroups: [...channel.credentialGroups, group] })
      }
      if (group) {
        await patchCredentialGroup(id, group.id, {
          tokenTail: tokenTailOf(token),
          hasToken: true,
        })
        if (slot === 'alt') await update(id, { altTokenTail: tokenTailOf(token), hasAltToken: true })
      } else {
        await update(id, { [fields.tail]: tokenTailOf(token), [fields.has]: true })
      }
    },
    async removeToken(id, slot = 'primary') {
      const channel = await repo.get(id)
      const fields = channel ? slotFields(channel, slot) : null
      if (!channel || !fields?.ref) return
      await secrets.remove(fields.ref)
      const group = [...channel.credentialGroups].sort(byPriority)[slot === 'alt' ? 1 : 0]
      if (group) {
        await patchCredentialGroup(id, group.id, { tokenTail: null, hasToken: false })
        if (slot === 'alt') await update(id, { altTokenTail: null, hasAltToken: false })
      } else {
        await update(id, { [fields.tail]: null, [fields.has]: false })
      }
    },
    async loadToken(id, slot = 'primary') {
      const channel = await repo.get(id)
      const ref = channel ? slotFields(channel, slot).ref : null
      return ref ? loadByRef(ref) : null
    },
    async hasToken(id, slot = 'primary') {
      const channel = await repo.get(id)
      const ref = channel ? slotFields(channel, slot).ref : null
      return ref ? (await loadByRef(ref)) !== null : false
    },
    credentialGroupOf(channel, groupId) {
      const group = groupId
        ? channel.credentialGroups.find((item) => item.id === groupId)
        : [...channel.credentialGroups].sort(byPriority)[0]
      if (!group) throw new Error(`[channelStore] 渠道没有可用的 Key 分组：${channel.name}`)
      return group
    },
    async addCredentialGroup(id, name) {
      const channel = await repo.get(id)
      if (!channel) throw new Error(`[channelStore] 渠道不存在：${id}`)
      const group: ChannelCredentialGroup = {
        id: createId('credgroup'),
        name: name?.trim() || `Key 分组 ${channel.credentialGroups.length + 1}`,
        credentialRef: createId('cred'),
        tokenTail: null,
        hasToken: false,
        priority: 0,
        models: [],
        modelCache: [],
        createdAt: Date.now(),
      }
      await update(id, { credentialGroups: [...channel.credentialGroups, group] })
      return group
    },
    async renameCredentialGroup(id, groupId, name) {
      await patchCredentialGroup(id, groupId, { name: name.trim() || '未命名分组' })
    },
    async setCredentialGroupPriority(id, groupId, priority) {
      await patchCredentialGroup(id, groupId, {
        priority: Number.isFinite(priority) ? Math.trunc(priority) : 0,
      })
    },
    async removeCredentialGroup(id, groupId) {
      const channel = await repo.get(id)
      if (!channel) return
      if (channel.credentialGroups.length <= 1) {
        throw new Error('至少要保留一个 Key 分组；不想使用这个渠道可以停用或删除渠道')
      }
      const target = channel.credentialGroups.find((group) => group.id === groupId)
      if (!target) return
      await update(id, {
        credentialGroups: channel.credentialGroups.filter((group) => group.id !== groupId),
      })
      await secrets.remove(target.credentialRef)
    },
    async saveCredentialGroupToken(id, groupId, token) {
      const channel = await repo.get(id)
      if (!channel) throw new Error(`[channelStore] 渠道不存在：${id}`)
      const group = channel.credentialGroups.find((item) => item.id === groupId)
      if (!group) throw new Error(`[channelStore] Key 分组不存在：${groupId}`)
      await secrets.save(group.credentialRef, token)
      await patchCredentialGroup(id, groupId, { tokenTail: tokenTailOf(token), hasToken: true })
    },
    async loadCredentialGroupToken(id, groupId) {
      const channel = await repo.get(id)
      const group = channel?.credentialGroups.find((item) => item.id === groupId)
      return group ? loadByRef(group.credentialRef) : null
    },
    async removeCredentialGroupToken(id, groupId) {
      const channel = await repo.get(id)
      const group = channel?.credentialGroups.find((item) => item.id === groupId)
      if (!group) return
      await secrets.remove(group.credentialRef)
      await patchCredentialGroup(id, groupId, { tokenTail: null, hasToken: false })
    },
  }
}

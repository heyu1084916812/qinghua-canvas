import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { createChannelRepository } from '../project/channelRepository'
import { createChannelCredentials } from './channelCredentials'

const hostSources = {
  canvas: (
    import.meta.glob(
      '../../workbenches/canvas/execution/CanvasExecutionProvider.tsx',
      {
        eager: true,
        query: '?raw',
        import: 'default',
      },
    ) as Record<string, string>
  )['../../workbenches/canvas/execution/CanvasExecutionProvider.tsx'],
  ecommerce: (
    import.meta.glob(
      '../../workbenches/ecommerce/execution/EcommerceExecutionProvider.tsx',
      {
        eager: true,
        query: '?raw',
        import: 'default',
      },
    ) as Record<string, string>
  )['../../workbenches/ecommerce/execution/EcommerceExecutionProvider.tsx'],
  storyboard: (
    import.meta.glob('../../app/workbenchHosts/StoryboardExecutionHost.tsx', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>
  )['../../app/workbenchHosts/StoryboardExecutionHost.tsx'],
}

function fixture() {
  const platform = createMemoryPlatform()
  const repo = createChannelRepository(platform.storage, platform.credentials)
  const channels = new Map<string, Awaited<ReturnType<typeof repo.get>>>()
  const credentials = createChannelCredentials(
    { get: (id) => repo.get(id) },
    platform.credentials,
    async (id, patch) => {
      const next = await repo.update(id, patch)
      channels.set(id, next)
      return next
    },
  )
  return { platform, repo, credentials, channels }
}

describe('channelCredentials', () => {
  it('owns primary/alt reads, group reads, and short-token metadata through injected ports', async () => {
    const { repo, credentials, channels } = fixture()
    const channel = await repo.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    channels.set(channel.id, channel)

    await credentials.saveToken(channel.id, '431959*Sh')
    await credentials.saveToken(channel.id, 'alt-token', 'alt')
    const saved = channels.get(channel.id)!

    expect(saved?.hasToken).toBe(true)
    expect(saved?.hasAltToken).toBe(true)
    expect(saved?.tokenTail).toBeNull()
    expect(await credentials.loadToken(channel.id)).toBe('431959*Sh')
    expect(await credentials.loadToken(channel.id, 'alt')).toBe('alt-token')
    expect(await credentials.hasToken(channel.id)).toBe(true)
    expect(await credentials.loadByRef(channel.credentialRef!)).toBe('431959*Sh')

    const group = await credentials.addCredentialGroup(channel.id, ' Backup ')
    expect(group.name).toBe('Backup')
    expect(group.priority).toBe(0)
    expect(group.models).toEqual([])
    await credentials.saveCredentialGroupToken(channel.id, group.id, 'sk-group')
    await credentials.renameCredentialGroup(channel.id, group.id, 'Renamed')
    await credentials.setCredentialGroupPriority(channel.id, group.id, 3.9)
    expect(await credentials.loadCredentialGroupToken(channel.id, group.id)).toBe('sk-group')
    expect(credentials.credentialGroupOf(channels.get(channel.id)!, group.id).name).toBe('Renamed')

    await credentials.removeCredentialGroupToken(channel.id, group.id)
    expect(await credentials.loadCredentialGroupToken(channel.id, group.id)).toBeNull()
    await credentials.removeCredentialGroup(channel.id, group.id)
    expect(channels.get(channel.id)?.credentialGroups.some((item) => item.id === group.id)).toBe(false)
  })

  it('fails without writing metadata when secret persistence fails', async () => {
    const platform = createMemoryPlatform()
    const repo = createChannelRepository(platform.storage, platform.credentials)
    const channel = await repo.create({ name: 'Failure', protocol: 'mock', baseUrl: '' })
    let writes = 0
    const credentials = createChannelCredentials(repo, {
      ...platform.credentials,
      async save() {
        throw new Error('credential storage unavailable')
      },
    }, async (id, patch) => {
      writes += 1
      return repo.update(id, patch)
    })

    await expect(credentials.saveToken(channel.id, 'never-stored')).rejects.toThrow(
      'credential storage unavailable',
    )
    expect(writes).toBe(0)
    expect((await repo.get(channel.id))?.hasToken).toBe(false)
  })

  it('does not expose a write path to an injected read-only runtime adapter', async () => {
    const { repo, credentials } = fixture()
    const channel = await repo.create({ name: 'Read only', protocol: 'mock', baseUrl: '' })
    await repo.saveToken(channel.credentialRef!, 'runtime-key')

    const readPort = { load: credentials.loadByRef }
    expect(await readPort.load(channel.credentialRef!)).toBe('runtime-key')
    expect(Object.keys(readPort)).toEqual(['load'])
  })

  it('routes all execution-host token reads through the repository credential adapter', () => {
    for (const source of Object.values(hostSources)) {
      expect(source).toMatch(/\.credentials\.load\(credentialRef\)/)
      expect(source).not.toMatch(/\.loadToken\(credentialRef\)/)
    }
  })
})

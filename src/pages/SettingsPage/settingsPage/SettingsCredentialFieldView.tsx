import type { Channel, ChannelCredentialGroup } from '../../../domain/project/channel'
import type { ChannelStore } from '../../../state/channel/channelStore'
import { ChannelTokenField } from '../SettingsChannelTokenField'
import { settingsPageStyles as styles } from './settingsPageStyles'

export function SettingsCredentialFieldView({
  channels,
  selected,
  activeGroup,
  selectedKeyGroups,
  credentialSlots,
  docUrl,
}: {
  channels: ChannelStore
  selected: Channel
  activeGroup: ChannelCredentialGroup | null
  selectedKeyGroups: ChannelCredentialGroup[]
  credentialSlots: { id: string; label: string; hint?: string; required?: boolean }[]
  docUrl: string
}) {
  return (
    <div className={styles.credentialFieldStack} data-settings-credential-fields>
      {activeGroup ? (
        <ChannelTokenField
          key={activeGroup.id}
          channels={channels}
          channelId={selected.id}
          slot={selectedKeyGroups[0]?.id === activeGroup.id ? 'primary' : 'alt'}
          groupId={activeGroup.id}
          label="API Key"
          docUrl={docUrl}
          savedTail={activeGroup.tokenTail}
          saved={activeGroup.hasToken}
        />
      ) : credentialSlots.length > 0 ? (
        credentialSlots.map((credential, index) => (
          <ChannelTokenField
            key={credential.id}
            channels={channels}
            channelId={selected.id}
            slot={index === 0 ? 'primary' : 'alt'}
            label={credential.label}
            hint={credential.hint}
            required={credential.required}
            docUrl={docUrl}
            savedTail={index === 0 ? selected.tokenTail : selected.altTokenTail}
            saved={index === 0 ? selected.hasToken : selected.hasAltToken}
          />
        ))
      ) : (
        <ChannelTokenField
          channels={channels}
          channelId={selected.id}
          slot="primary"
          label="API Key"
          docUrl={docUrl}
          savedTail={selected.tokenTail}
          saved={selected.hasToken}
        />
      )}
    </div>
  )
}

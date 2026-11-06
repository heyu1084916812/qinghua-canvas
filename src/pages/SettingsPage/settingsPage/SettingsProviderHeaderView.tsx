import { IconGear } from '../../../app/SettingsIcons'
import { SettingsChannelAvatar } from '../SettingsChannelAvatar'
import { settingsPageStyles as styles } from './settingsPageStyles'

export type SettingsProviderHeaderViewProps = {
  channelId: string
  protocol: string
  icon: string | null | undefined
  name: string
  ariaName: string
  enabled: boolean
  onEditProfile: (channelId: string) => void
  onEnabledChange: (enabled: boolean) => void
}

export function SettingsProviderHeaderView({
  channelId,
  protocol,
  icon,
  name,
  ariaName,
  enabled,
  onEditProfile,
  onEnabledChange,
}: SettingsProviderHeaderViewProps) {
  return (
    <div className={styles.providerEditorHead} data-settings-provider-head>
      <SettingsChannelAvatar protocol={protocol} icon={icon} name={name} size={34} />
      <div className={styles.providerNameGroup}>
        <span className={styles.providerNameText} data-settings-name>
          {name}
        </span>
        <button
          type="button"
          className={styles.providerGear}
          data-settings-profile-edit
          aria-label="编辑服务资料"
          title="编辑服务资料"
          onClick={() => onEditProfile(channelId)}
        >
          <IconGear size={16} />
        </button>
      </div>
      <label className={styles.switch} title={enabled ? '停用模型服务' : '启用模型服务'}>
        <input
          className={styles.switchInput}
          type="checkbox"
          checked={enabled}
          aria-label={`${ariaName}：${enabled ? '已启用' : '未启用'}`}
          data-channel-enabled={channelId}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        <span className={styles.switchTrack} aria-hidden="true" />
      </label>
    </div>
  )
}

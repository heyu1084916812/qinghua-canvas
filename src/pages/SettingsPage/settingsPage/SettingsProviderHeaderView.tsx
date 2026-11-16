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
  priority: number
  weight: number
  onEditProfile: (channelId: string) => void
  onEnabledChange: (enabled: boolean) => void
  onPriorityChange: (value: number) => void
  onWeightChange: (value: number) => void
}

export function SettingsProviderHeaderView({
  channelId,
  protocol,
  icon,
  name,
  ariaName,
  enabled,
  priority,
  weight,
  onEditProfile,
  onEnabledChange,
  onPriorityChange,
  onWeightChange,
}: SettingsProviderHeaderViewProps) {
  return (
    <div className={styles.providerEditorBlock} data-settings-provider-head>
      <div className={styles.providerEditorHead}>
        <SettingsChannelAvatar protocol={protocol} icon={icon} name={name} size={34} />
        <div className={styles.providerNameGroup} data-settings-provider-name-row>
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
            <IconGear size="md" />
          </button>
          <div
            className={styles.providerRouteInline}
            data-settings-channel-routing-panel
            data-settings-provider-route-inline
          >
            <label className={styles.providerRouteField}>
              <span>优先级</span>
              <input
                type="number"
                value={priority}
                aria-label="渠道优先级"
                data-route-priority
                onChange={(event) => onPriorityChange(Number(event.target.value))}
              />
            </label>
            <label className={styles.providerRouteField}>
              <span>权重</span>
              <input
                type="number"
                min={0}
                value={weight}
                aria-label="渠道权重"
                data-route-weight
                onChange={(event) => onWeightChange(Number(event.target.value))}
              />
            </label>
          </div>
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
    </div>
  )
}

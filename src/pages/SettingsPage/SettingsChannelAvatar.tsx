import { ChannelIcon, hasChannelBrandIcon } from '../../features/shared/channelIcon/ChannelIcon'
import styles from './SettingsPage.module.css'
import { channelInitial, channelMonogramTone } from './settingsPageConstants'

export function SettingsChannelAvatar({
  channelId,
  protocol,
  icon,
  name,
  size,
}: {
  channelId?: string
  protocol: string
  icon?: string | null
  name: string
  size: number
}) {
  const hasVisual = Boolean(icon) || hasChannelBrandIcon(protocol)
  const kind = hasVisual ? 'image' : 'monogram'
  return (
    <span
      className={
        hasVisual
          ? `${styles.channelAvatarFrame} ${styles.channelAvatarOutline}`
          : `${styles.channelAvatarFrame} ${styles.channelAvatarFilled} ${styles[`monogramTone${channelMonogramTone(name)}`]}`
      }
      data-channel-avatar-frame
      data-channel-avatar-kind={kind}
      data-channel-monogram={hasVisual ? undefined : channelId}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {hasVisual ? (
        <ChannelIcon
          protocol={protocol}
          icon={icon}
          size={Math.max(14, size - 4)}
        />
      ) : (
        <span
          className={styles.channelMonogramText}
          style={{ fontSize: Math.max(12, Math.round(size * 0.4)) }}
        >
          {channelInitial(name)}
        </span>
      )}
    </span>
  )
}

import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react'
import { ChoicePicker } from '../../../features/shared/choicePicker/ChoicePicker'
import { isBuiltinChannelId } from '../../../domain/project/builtinChannels'
import {
  channelCapabilities,
  protocolShort,
  type Channel,
} from '../../../domain/project/channel'
import {
  protocolById,
  type ProtocolCatalog,
} from '../../../domain/project/protocol'
import {
  IconFilter,
  IconGrip,
  IconMoreVertical,
  IconSearch,
} from '../../../app/SettingsIcons'
import { SettingsChannelAvatar } from '../SettingsChannelAvatar'
import {
  CHANNEL_FILTER_OPTIONS,
  type ChannelFilterKey,
} from '../settingsPageConstants'
import { settingsPageStyles as styles } from './settingsPageStyles'

export type SettingsChannelSidebarViewProps = {
  catalog: ProtocolCatalog
  channels: readonly Channel[]
  visibleChannels: readonly Channel[]
  selectedId: string | null
  channelSearch: string
  channelFilter: ChannelFilterKey
  dragId: string | null
  openChannelId: string | null
  onSearchChange: (value: string) => void
  onFilterChange: (value: ChannelFilterKey) => void
  onSelectChannel: (channelId: string) => void
  onOpenChannelMenu: (channelId: string, x: number, y: number) => void
  onOpenChannelMenuFromButton: (
    event: ReactMouseEvent<HTMLButtonElement>,
    channelId: string,
  ) => void
  onDragStart: (channelId: string) => void
  onDragEnd: () => void
  onDropOnChannel: (channelId: string) => void
  onCreate: () => void
}

export function SettingsChannelSidebarView({
  catalog,
  channels,
  visibleChannels,
  selectedId,
  channelSearch,
  channelFilter,
  dragId,
  openChannelId,
  onSearchChange,
  onFilterChange,
  onSelectChannel,
  onOpenChannelMenu,
  onOpenChannelMenuFromButton,
  onDragStart,
  onDragEnd,
  onDropOnChannel,
  onCreate,
}: SettingsChannelSidebarViewProps) {
  return (
    <aside className={styles.sidebar} data-settings-sidebar>
      <div className={styles.sidebarTools} data-channel-tools>
        <div className={styles.channelSearch}>
          <IconSearch size="md" />
          <input
            value={channelSearch}
            data-channel-search
            placeholder="搜索模型平台..."
            aria-label="搜索模型服务"
            onChange={(event) => onSearchChange(event.target.value)}
          />
          <ChoicePicker
            name="channel-filter"
            value={channelFilter}
            compact
            iconOnly
            alignEnd
            triggerIcon={<IconFilter size="md" />}
            ariaLabel="筛选模型服务"
            options={CHANNEL_FILTER_OPTIONS}
            onChange={(value) => onFilterChange(value as ChannelFilterKey)}
            className={styles.channelFilterPicker}
          />
        </div>
      </div>
      <ul className={styles.list} data-channel-list>
        {visibleChannels.map((ch: Channel) => {
          const caps = channelCapabilities(
            ch,
            protocolById(ch.protocol, catalog)?.capabilities ?? [],
          )
          return (
            <li key={ch.id}>
              <div
                className={
                  ch.id === selectedId
                    ? `${styles.item} ${styles.itemActive}`
                    : styles.item
                }
                data-channel-item
                data-channel-id={ch.id}
                data-channel-selected={ch.id === selectedId ? 'true' : undefined}
                data-channel-proto={protocolShort(ch.protocol, catalog)}
                data-channel-enabled-state={ch.enabled ? 'true' : 'false'}
                data-channel-caps={(['chat', 'image', 'video'] as const)
                  .filter((key) => caps[key])
                  .join(',')}
                data-channel-fixed={isBuiltinChannelId(ch.id) ? 'true' : undefined}
                data-dragging={dragId === ch.id ? 'true' : undefined}
                data-menu-open={openChannelId === ch.id ? 'true' : undefined}
                onContextMenu={(event) => {
                  event.preventDefault()
                  onOpenChannelMenu(ch.id, event.clientX, event.clientY)
                }}
                onDragOver={(event: ReactDragEvent<HTMLDivElement>) => {
                  if (!dragId) return
                  event.preventDefault()
                }}
                onDrop={(event: ReactDragEvent<HTMLDivElement>) => {
                  if (!dragId) return
                  event.preventDefault()
                  onDropOnChannel(ch.id)
                }}
              >
                <span className={styles.dragHandleSlot}>
                  {!isBuiltinChannelId(ch.id) ? (
                    <button
                      type="button"
                      className={styles.dragHandle}
                      draggable
                      aria-label={`拖动 ${ch.name} 排序`}
                      title="拖动排序"
                      data-channel-drag-handle={ch.id}
                      onDragStart={(event) => {
                        event.stopPropagation()
                        onDragStart(ch.id)
                      }}
                      onDragEnd={onDragEnd}
                    >
                      <IconGrip size="sm" />
                    </button>
                  ) : null}
                </span>
                <button
                  type="button"
                  className={styles.itemMain}
                  onPointerDown={(event) => {
                    if (event.button === 0) onSelectChannel(ch.id)
                  }}
                  onClick={() => onSelectChannel(ch.id)}
                  onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
                    const menuKey =
                      event.key === 'ContextMenu' ||
                      (event.shiftKey && event.key === 'F10')
                    if (!menuKey) return
                    event.preventDefault()
                    const rect = event.currentTarget.getBoundingClientRect()
                    onOpenChannelMenu(ch.id, rect.right - 8, rect.top + rect.height)
                  }}
                >
                  <span className={styles.itemIcon} data-channel-icon-box>
                    <SettingsChannelAvatar
                      channelId={ch.id}
                      protocol={ch.protocol}
                      icon={ch.icon}
                      name={ch.name}
                      size={24}
                    />
                  </span>
                  <span className={styles.itemBody} data-channel-body>
                    <span className={styles.itemName}>{ch.name}</span>
                  </span>
                </button>
                <span className={styles.itemTrailing}>
                  {ch.enabled ? (
                    <span
                      className={styles.itemEnabledDot}
                      data-channel-state-dot={ch.id}
                      data-enabled="true"
                      title="已启用"
                      aria-label="已启用"
                    />
                  ) : null}
                  <button
                    type="button"
                    className={styles.itemMenuTrigger}
                    data-channel-menu-trigger={ch.id}
                    aria-label={`打开 ${ch.name} 菜单`}
                    aria-haspopup="menu"
                    aria-expanded={openChannelId === ch.id}
                    title="更多操作"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => onOpenChannelMenuFromButton(event, ch.id)}
                  >
                    <IconMoreVertical size="md" />
                  </button>
                </span>
              </div>
            </li>
          )
        })}
        {visibleChannels.length === 0 && (
          <li className={styles.empty}>
            {channels.length === 0
              ? '还没有模型服务，点下方「添加服务商」'
              : '没有符合搜索或筛选条件的模型服务'}
          </li>
        )}
      </ul>
      <div className={styles.sidebarFoot}>
        <button className={styles.addBtn} data-channel-add onClick={onCreate}>
          + 添加服务商
        </button>
      </div>
    </aside>
  )
}

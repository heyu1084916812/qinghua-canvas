import { createPortal } from 'react-dom'
import type { MutableRefObject } from 'react'
import type { Channel } from '../../../domain/project/channel'
import { channelMenuPresentationFor } from './settingsChannelPresentation'
import { SettingsChannelContextMenuView } from './SettingsChannelContextMenuView'
import { SettingsProfileDrawerView } from './SettingsProfileDrawerView'

type DrawerBounds = { left: number; top: number; width: number; height: number }
type MenuPoint = { channelId: string; x: number; y: number }

export type SettingsChannelOverlaysProps = {
  channel: Channel | null
  channelsList: readonly Channel[]
  profileDrawerOpen: boolean
  profileDrawerBounds: DrawerBounds | null
  profileNameDraft: string
  profileIconDraft: string | null
  profileSaving: boolean
  profileFileRef: MutableRefObject<HTMLInputElement | null>
  channelMenu: MenuPoint | null
  channelMenuRef: MutableRefObject<HTMLDivElement | null>
  menuConfirmDelete: boolean
  busy: boolean
  onProfileClose: () => void
  onProfileIconFile: (file: File | undefined) => void
  onProfileUseBuiltin: () => void
  onProfileResetIcon: () => void
  onProfileNameChange: (name: string) => void
  onProfileSave: () => void
  onMenuEdit: (channelId: string) => void
  onMenuRequestDelete: () => void
  onMenuConfirmDelete: (channelId: string) => void
  onMenuCancelDelete: () => void
}

/**
 * 渠道页的两块 portal 浮层：服务资料抽屉 + 渠道右键菜单（用户 2026-11-18「继续」：按卡拆分收口）。
 *
 * 位置计算（`channelMenuPresentationFor` + 视口）跟着搬进来，因为它只给这个菜单用：
 * 窗口尺寸在渲染时读一次，页面因此少一份「用完即弃」的派生。
 * 两份浮层的**状态仍归页面**——菜单的 `openChannelId` 要喂侧栏高亮、
 * 抽屉的 open / bounds 由 `watchProfileDrawer` 的 effect 驱动。
 */
export function SettingsChannelOverlays({
  channel,
  channelsList,
  profileDrawerOpen,
  profileDrawerBounds,
  profileNameDraft,
  profileIconDraft,
  profileSaving,
  profileFileRef,
  channelMenu,
  channelMenuRef,
  menuConfirmDelete,
  busy,
  onProfileClose,
  onProfileIconFile,
  onProfileUseBuiltin,
  onProfileResetIcon,
  onProfileNameChange,
  onProfileSave,
  onMenuEdit,
  onMenuRequestDelete,
  onMenuConfirmDelete,
  onMenuCancelDelete,
}: SettingsChannelOverlaysProps) {
  const {
    channel: menuChannel,
    builtin: menuBuiltin,
    width: menuWidth,
    left: menuLeft,
    top: menuTop,
  } = channelMenuPresentationFor(
    channelsList,
    channelMenu,
    { width: window.innerWidth, height: window.innerHeight },
    menuConfirmDelete,
  )

  return (
    <>
      {profileDrawerOpen && channel && profileDrawerBounds
        ? createPortal(
            <SettingsProfileDrawerView
              protocol={channel.protocol}
              icon={profileIconDraft}
              name={profileNameDraft}
              saving={profileSaving}
              bounds={profileDrawerBounds}
              fileInputRef={profileFileRef}
              onBackdropClose={onProfileClose}
              onClose={onProfileClose}
              onIconFile={onProfileIconFile}
              onUseBuiltin={onProfileUseBuiltin}
              onResetIcon={onProfileResetIcon}
              onNameChange={onProfileNameChange}
              onSave={onProfileSave}
            />,
            document.body,
          )
        : null}
      {channelMenu && menuChannel
        ? createPortal(
            <SettingsChannelContextMenuView
              menuRef={channelMenuRef}
              channelId={menuChannel.id}
              channelName={menuChannel.name}
              builtin={menuBuiltin}
              confirmDelete={menuConfirmDelete}
              busy={busy}
              left={menuLeft}
              top={menuTop}
              width={menuWidth}
              onEdit={onMenuEdit}
              onRequestDelete={onMenuRequestDelete}
              onConfirmDelete={onMenuConfirmDelete}
              onCancelDelete={onMenuCancelDelete}
            />,
            document.body,
          )
        : null}
    </>
  )
}

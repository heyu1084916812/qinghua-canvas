import type { MutableRefObject } from 'react'
import {
  IconChannels,
  IconClose,
  IconImageUpload,
  IconResetAvatar,
} from '../../../app/SettingsIcons'
import { SettingsChannelAvatar } from '../SettingsChannelAvatar'
import { settingsPageStyles as styles } from './settingsPageStyles'

export type SettingsProfileDrawerViewProps = {
  protocol: string
  icon: string | null | undefined
  name: string
  saving: boolean
  bounds: { left: number; top: number; width: number; height: number }
  fileInputRef: MutableRefObject<HTMLInputElement | null>
  onBackdropClose: () => void
  onClose: () => void
  onIconFile: (file: File | undefined) => void
  onUseBuiltin: () => void
  onResetIcon: () => void
  onNameChange: (name: string) => void
  onSave: () => void
}

export function SettingsProfileDrawerView({
  protocol,
  icon,
  name,
  saving,
  bounds,
  fileInputRef,
  onBackdropClose,
  onClose,
  onIconFile,
  onUseBuiltin,
  onResetIcon,
  onNameChange,
  onSave,
}: SettingsProfileDrawerViewProps) {
  return (
    <div className={styles.profileDrawerLayer} style={bounds}>
      <div
        className={styles.profileDrawerBackdrop}
        aria-hidden
        onPointerDown={onBackdropClose}
      />
      <aside
        className={styles.profileDrawer}
        data-settings-profile-drawer
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-profile-drawer-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className={styles.profileDrawerHead}>
          <h2 id="settings-profile-drawer-title">编辑</h2>
          <button
            type="button"
            className={styles.profileDrawerClose}
            data-settings-profile-close
            aria-label="关闭编辑"
            title="关闭"
            onClick={onClose}
          >
            <IconClose size="md" />
          </button>
        </header>
        <div className={styles.profileDrawerBody}>
          <div className={styles.profileAvatarPreview}>
            <SettingsChannelAvatar
              protocol={protocol}
              icon={icon}
              name={name}
              size={76}
            />
          </div>
          <div className={styles.profileAvatarActions}>
            <label className={styles.profileAvatarButton} data-settings-profile-upload>
              <IconImageUpload size="md" />
              图片上传
              <input
                ref={fileInputRef}
                className={styles.fileInput}
                type="file"
                accept="image/*"
                onChange={(event) => {
                  onIconFile(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
            </label>
            <button
              type="button"
              className={styles.profileAvatarButton}
              data-settings-profile-builtin
              onClick={onUseBuiltin}
            >
              <IconChannels size="md" />
              内置头像
            </button>
            <button
              type="button"
              className={styles.profileAvatarButton}
              data-settings-profile-reset
              onClick={() => onResetIcon()}
            >
              <IconResetAvatar size="md" />
              重置头像
            </button>
          </div>
          <label className={styles.profileField}>
            <span>
              服务商名称 <b aria-hidden>*</b>
            </span>
            <input
              className={styles.profileInput}
              data-settings-profile-name
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </label>
        </div>
        <footer className={styles.profileDrawerFoot}>
          <button type="button" className={styles.profileCancel} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={styles.profileSave}
            data-settings-profile-save
            disabled={saving || !name.trim()}
            onClick={onSave}
          >
            {saving ? '保存中' : '保存'}
          </button>
        </footer>
      </aside>
    </div>
  )
}

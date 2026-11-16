import { useEffect, useState } from 'react'
import type { Channel, ChannelCredentialGroup } from '../../../domain/project/channel'
import type { ChannelStore } from '../../../state/channel/channelStore'
import { ChannelTokenField } from '../SettingsChannelTokenField'
import { settingsPageStyles as styles } from './settingsPageStyles'

export type SettingsKeyGroupViewProps = {
  channels: ChannelStore
  selected: Channel
  activeGroup: ChannelCredentialGroup | null
  selectedKeyGroups: ChannelCredentialGroup[]
  credentialSlots: { id: string; label: string; hint?: string; required?: boolean }[]
  busy: boolean
  docUrl: string
  onAddKeyGroup: () => Promise<void>
  onRemoveKeyGroup: () => Promise<void>
  onActiveGroupChange: (groupId: string) => void
  onRenameKeyGroup: (groupId: string, name: string) => void
  onSetKeyGroupPriority: (groupId: string, priority: number) => void
}

export function SettingsKeyGroupView({
  channels,
  selected,
  activeGroup,
  selectedKeyGroups,
  credentialSlots,
  busy,
  docUrl,
  onAddKeyGroup,
  onRemoveKeyGroup,
  onActiveGroupChange,
  onRenameKeyGroup,
  onSetKeyGroupPriority,
}: SettingsKeyGroupViewProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => setConfirmDelete(false), [activeGroup?.id])

  return (
    <section className={styles.keyGroupSurface} data-key-groups>
      <div className={styles.keyGroupSwitcher} data-key-group-switcher>
        <div className={styles.keyGroupTabs} role="tablist" aria-label="Key 分组">
          {selectedKeyGroups.length === 0 ? (
            <span className={`${styles.keyGroupTab} ${styles.keyGroupTabOn}`}>
              <span
                className={selected.hasToken ? styles.keyGroupDotOn : styles.keyGroupDotOff}
                aria-hidden
              />
              默认分组
            </span>
          ) : (
            selectedKeyGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                role="tab"
                aria-selected={group.id === activeGroup?.id}
                className={
                  group.id === activeGroup?.id
                    ? `${styles.keyGroupTab} ${styles.keyGroupTabOn}`
                    : styles.keyGroupTab
                }
                data-key-group-tab={group.id}
                onClick={() => onActiveGroupChange(group.id)}
              >
                <span
                  className={group.hasToken ? styles.keyGroupDotOn : styles.keyGroupDotOff}
                  aria-hidden
                />
                {group.name}
              </button>
            ))
          )}
        </div>
        <button
          type="button"
          className={styles.ghostBtn}
          data-key-group-add
          disabled={busy}
          onClick={() => void onAddKeyGroup()}
        >
          + 添加分组
        </button>
      </div>

      <div className={styles.keyGroupBody} data-key-group-body>
        {!activeGroup ? (
          credentialSlots.length > 0 ? (
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
          )
        ) : (
          <>
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

            <div className={styles.groupPropertyStrip} data-key-group-editor={activeGroup.id}>
              <label className={styles.groupPropertyField}>
                <span>分组名称</span>
                <input
                  key={`${activeGroup.id}-name`}
                  defaultValue={activeGroup.name}
                  data-key-group-name
                  onBlur={(event) => {
                    const value = event.target.value.trim()
                    if (value && value !== activeGroup.name) {
                      onRenameKeyGroup(activeGroup.id, value)
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
              </label>
              <label className={`${styles.groupPropertyField} ${styles.groupPriorityField}`}>
                <span>优先级</span>
                <input
                  key={`${activeGroup.id}-priority`}
                  type="number"
                  defaultValue={activeGroup.priority}
                  data-key-group-priority
                  onBlur={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value) && value !== activeGroup.priority) {
                      onSetKeyGroupPriority(activeGroup.id, value)
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
              </label>
              <div className={styles.groupDanger}>
                {confirmDelete ? (
                  <>
                    <span>删除此分组？</span>
                    <button
                      type="button"
                      className={styles.dangerTextButton}
                      disabled={busy}
                      onClick={() => void onRemoveKeyGroup()}
                    >
                      确认
                    </button>
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      onClick={() => setConfirmDelete(false)}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.dangerTextButton}
                    data-key-group-remove
                    disabled={busy || selectedKeyGroups.length <= 1}
                    onClick={() => setConfirmDelete(true)}
                  >
                    删除分组
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

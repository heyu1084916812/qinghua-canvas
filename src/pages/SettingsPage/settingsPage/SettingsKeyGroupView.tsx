import { useEffect, useState, type SyntheticEvent } from 'react'
import type { ChannelCredentialGroup } from '../../../domain/project/channel'
import { IconDelete, IconEdit } from '../../../app/SettingsIcons'
import { IconPlus } from '../../../app/ProjectTreeIcons'
import { settingsPageStyles as styles } from './settingsPageStyles'

export type SettingsKeyGroupViewProps = {
  activeGroup: ChannelCredentialGroup | null
  selectedKeyGroups: ChannelCredentialGroup[]
  busy: boolean
  onAddKeyGroup: () => Promise<void>
  onRemoveKeyGroup: () => Promise<void>
  onActiveGroupChange: (groupId: string) => void
  onRenameKeyGroup: (groupId: string, name: string) => void
  onSetKeyGroupPriority: (groupId: string, priority: number) => void
}

export function SettingsKeyGroupView({
  activeGroup,
  selectedKeyGroups,
  busy,
  onAddKeyGroup,
  onRemoveKeyGroup,
  onActiveGroupChange,
  onRenameKeyGroup,
  onSetKeyGroupPriority,
}: SettingsKeyGroupViewProps) {
  const [renameId, setRenameId] = useState<string | null>(null)
  const [priorityId, setPriorityId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    setRenameId(null)
    setPriorityId(null)
    setConfirmDeleteId(null)
  }, [activeGroup?.id])

  const stop = (event: SyntheticEvent) => event.stopPropagation()
  const selectGroup = (groupId: string) => {
    if (groupId !== activeGroup?.id) onActiveGroupChange(groupId)
  }

  return (
    <section className={styles.keyGroupTabsBar} data-key-groups>
      <div className={styles.keyGroupSwitcher} data-key-group-switcher>
        <div className={styles.keyGroupTabs} role="tablist" aria-label="Key 分组">
          {selectedKeyGroups.length === 0 ? (
            <div
              className={`${styles.keyGroupTab} ${styles.keyGroupTabOn}`}
              role="tab"
              aria-selected="true"
            >
              <span className={styles.keyGroupTabShape} aria-hidden />
              <span className={styles.keyGroupTabContent}>
                <span className={styles.keyGroupDotOn} aria-hidden />
                <span className={styles.keyGroupTabName}>默认分组</span>
              </span>
            </div>
          ) : (
            selectedKeyGroups.map((group) => {
              const selected = group.id === activeGroup?.id
              return (
                <div
                  key={group.id}
                  className={
                    selected
                      ? `${styles.keyGroupTab} ${styles.keyGroupTabOn}`
                      : styles.keyGroupTab
                  }
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  data-key-group-tab={group.id}
                  data-key-group-editor={selected ? group.id : undefined}
                  onClick={() => selectGroup(group.id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    selectGroup(group.id)
                  }}
                >
                  <span className={styles.keyGroupTabShape} aria-hidden />
                  <span className={styles.keyGroupTabContent}>
                    {selected ? (
                      <span
                        className={group.hasToken ? styles.keyGroupDotOn : styles.keyGroupDotOff}
                        aria-hidden
                      />
                    ) : null}
                    {selected && renameId === group.id ? (
                      <input
                        className={styles.keyGroupNameInput}
                        defaultValue={group.name}
                        aria-label="分组名称"
                        data-key-group-name
                        autoFocus
                        onClick={stop}
                        onBlur={(event) => {
                          const value = event.target.value.trim()
                          if (value && value !== group.name) onRenameKeyGroup(group.id, value)
                          setRenameId(null)
                        }}
                        onKeyDown={(event) => {
                          event.stopPropagation()
                          if (event.key === 'Enter') event.currentTarget.blur()
                          if (event.key === 'Escape') setRenameId(null)
                        }}
                      />
                    ) : (
                      <span className={styles.keyGroupTabName}>{group.name}</span>
                    )}

                    <span
                      className={
                        selected
                          ? `${styles.keyGroupTabMeta} ${styles.keyGroupTabMetaOn}`
                          : styles.keyGroupTabMeta
                      }
                      aria-hidden={!selected}
                    >
                      {selected && priorityId === group.id ? (
                        <label className={styles.keyGroupPriorityInput}>
                          <span>P</span>
                          <input
                            type="number"
                            defaultValue={group.priority}
                            aria-label="分组优先级"
                            data-key-group-priority
                            autoFocus
                            onClick={stop}
                            onBlur={(event) => {
                              const value = Number(event.target.value)
                              if (Number.isFinite(value) && value !== group.priority) {
                                onSetKeyGroupPriority(group.id, Math.trunc(value))
                              }
                              setPriorityId(null)
                            }}
                            onKeyDown={(event) => {
                              event.stopPropagation()
                              if (event.key === 'Enter') event.currentTarget.blur()
                              if (event.key === 'Escape') setPriorityId(null)
                            }}
                          />
                        </label>
                      ) : (
                        <button
                          type="button"
                          className={styles.keyGroupPriorityBadge}
                          tabIndex={selected ? 0 : -1}
                          title="修改分组优先级"
                          onClick={(event) => {
                            stop(event)
                            setPriorityId(group.id)
                          }}
                        >
                          P{group.priority}
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.keyGroupIconButton}
                        tabIndex={selected ? 0 : -1}
                        aria-label={`重命名分组 ${group.name}`}
                        title="重命名分组"
                        onClick={(event) => {
                          stop(event)
                          setRenameId(group.id)
                        }}
                      >
                        <IconEdit size="sm" />
                      </button>
                      {confirmDeleteId === group.id ? (
                        <span className={styles.keyGroupDeleteConfirm}>
                          <button
                            type="button"
                            tabIndex={selected ? 0 : -1}
                            disabled={busy}
                            onClick={(event) => {
                              stop(event)
                              void onRemoveKeyGroup()
                            }}
                          >
                            确认
                          </button>
                          <button
                            type="button"
                            tabIndex={selected ? 0 : -1}
                            onClick={(event) => {
                              stop(event)
                              setConfirmDeleteId(null)
                            }}
                          >
                            取消
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={styles.keyGroupDangerButton}
                          tabIndex={selected ? 0 : -1}
                          aria-label={`删除分组 ${group.name}`}
                          title="删除分组"
                          disabled={busy || selectedKeyGroups.length <= 1}
                          onClick={(event) => {
                            stop(event)
                            setConfirmDeleteId(group.id)
                          }}
                        >
                          <IconDelete size="sm" />
                        </button>
                      )}
                    </span>
                  </span>
                </div>
              )
            })
          )}

          <button
            type="button"
            className={styles.keyGroupAddTab}
            data-key-group-add
            aria-label="添加分组"
            title="添加分组"
            disabled={busy}
            onClick={() => void onAddKeyGroup()}
          >
            <IconPlus size="sm" />
          </button>
        </div>
      </div>
    </section>
  )
}

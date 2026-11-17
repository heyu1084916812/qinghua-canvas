import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { ChannelCredentialGroup } from '../../../domain/project/channel'
import { IconPlus } from '../../../app/ProjectTreeIcons'
import { KEY_GROUP_MENU_WIDTH, SettingsKeyGroupMenuView } from './SettingsKeyGroupMenuView'
import { settingsPageStyles as styles } from './settingsPageStyles'

export type SettingsKeyGroupViewProps = {
  activeGroup: ChannelCredentialGroup | null
  selectedKeyGroups: ChannelCredentialGroup[]
  busy: boolean
  onAddKeyGroup: () => Promise<void>
  onRemoveKeyGroup: (groupId: string) => Promise<void>
  onActiveGroupChange: (groupId: string) => void
  onRenameKeyGroup: (groupId: string, name: string) => void
  onSetKeyGroupPriority: (groupId: string, priority: number) => void
}

type GroupMenuState = {
  groupId: string
  name: string
  left: number
  top: number
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
  const [renameDraft, setRenameDraft] = useState('')
  const [priorityId, setPriorityId] = useState<string | null>(null)
  const [menu, setMenu] = useState<GroupMenuState | null>(null)
  const [menuConfirm, setMenuConfirm] = useState(false)
  /* 选中态的梯形跟着选中的标题走：位置与宽度从真实 DOM 量出来，再靠 transform 滑动过去。 */
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)
  const [indicatorReady, setIndicatorReady] = useState(false)

  const tabsRef = useRef<HTMLDivElement | null>(null)
  const tabRefs = useRef(new Map<string, HTMLDivElement>())
  const menuRef = useRef<HTMLDivElement | null>(null)
  /* 双击还没选中的标题时，先切组再进编辑：这次 activeGroup 变化不能把刚打开的输入框关掉。 */
  const renameTargetRef = useRef<string | null>(null)

  useEffect(() => {
    if (renameTargetRef.current && renameTargetRef.current === activeGroup?.id) {
      renameTargetRef.current = null
      return
    }
    renameTargetRef.current = null
    setRenameId(null)
    setPriorityId(null)
    setMenu(null)
    setMenuConfirm(false)
  }, [activeGroup?.id])

  const measureIndicator = useCallback(() => {
    const container = tabsRef.current
    if (!container) return
    const active = container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    if (!active) {
      setIndicator(null)
      return
    }
    const containerRect = container.getBoundingClientRect()
    const activeRect = active.getBoundingClientRect()
    setIndicator({
      left: activeRect.left - containerRect.left + container.scrollLeft,
      width: activeRect.width,
    })
  }, [])

  useLayoutEffect(() => {
    measureIndicator()
    const container = tabsRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measureIndicator())
    observer.observe(container)
    const active = container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    if (active) observer.observe(active)
    return () => observer.disconnect()
  }, [measureIndicator, activeGroup?.id, selectedKeyGroups, renameId, priorityId])

  /* 首帧量完再打开过渡，避免梯形从 0 宽度滑进场。 */
  useEffect(() => {
    if (!indicator || indicatorReady) return
    const frame = requestAnimationFrame(() => setIndicatorReady(true))
    return () => cancelAnimationFrame(frame)
  }, [indicator, indicatorReady])

  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return
    let cancelled = false
    void document.fonts.ready.then(() => {
      if (!cancelled) measureIndicator()
    })
    return () => {
      cancelled = true
    }
  }, [measureIndicator])

  useEffect(() => {
    if (!menu) return
    const closeOnOutside = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setMenu(null)
      setMenuConfirm(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      /* 只关菜单：不挡住就一路冒到浮层，把整个设置页一起关掉。 */
      event.stopPropagation()
      event.preventDefault()
      setMenu(null)
      setMenuConfirm(false)
    }
    document.addEventListener('pointerdown', closeOnOutside, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menu])

  const stop = (event: SyntheticEvent) => event.stopPropagation()

  const selectGroup = (groupId: string) => {
    if (groupId !== activeGroup?.id) onActiveGroupChange(groupId)
    tabRefs.current.get(groupId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  const beginRename = (group: ChannelCredentialGroup) => {
    setMenu(null)
    setMenuConfirm(false)
    setPriorityId(null)
    setRenameDraft(group.name)
    renameTargetRef.current = group.id
    setRenameId(group.id)
  }

  const commitRename = (group: ChannelCredentialGroup) => {
    const value = renameDraft.trim()
    if (value && value !== group.name) onRenameKeyGroup(group.id, value)
    setRenameId(null)
  }

  const openMenu = (group: ChannelCredentialGroup, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setRenameId(null)
    setPriorityId(null)
    setMenuConfirm(false)
    if (group.id !== activeGroup?.id) onActiveGroupChange(group.id)
    const maxLeft =
      typeof window === 'undefined' ? event.clientX : window.innerWidth - KEY_GROUP_MENU_WIDTH - 8
    const maxTop = typeof window === 'undefined' ? event.clientY : window.innerHeight - 140
    setMenu({
      groupId: group.id,
      name: group.name,
      left: Math.max(8, Math.min(event.clientX, maxLeft)),
      top: Math.max(8, Math.min(event.clientY, maxTop)),
    })
  }

  const renderName = (group: ChannelCredentialGroup, selected: boolean) =>
    selected && renameId === group.id ? (
      <span className={styles.keyGroupNameField}>
        <span className={styles.keyGroupNameMirror} aria-hidden>
          {(renameDraft || ' ').trimEnd()}
        </span>
        <input
          className={styles.keyGroupNameInput}
          value={renameDraft}
          aria-label="分组名称"
          data-key-group-name
          autoFocus
          onClick={stop}
          onDoubleClick={stop}
          onChange={(event) => setRenameDraft(event.target.value)}
          onBlur={() => commitRename(group)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') setRenameId(null)
          }}
        />
      </span>
    ) : (
      <span
        className={styles.keyGroupTabName}
        data-key-group-name-text={selected ? group.id : undefined}
        title={selected ? '双击编辑名称' : group.name}
      >
        {group.name}
      </span>
    )

  return (
    <section className={styles.keyGroupTabsBar} data-key-groups>
      <div className={styles.keyGroupSwitcher} data-key-group-switcher>
        <div className={styles.keyGroupTabs} role="tablist" aria-label="Key 分组" ref={tabsRef}>
          {indicator ? (
            <span
              className={styles.keyGroupIndicator}
              aria-hidden
              data-key-group-indicator
              data-ready={indicatorReady ? 'true' : 'false'}
              style={{
                width: `${indicator.width}px`,
                transform: `translateX(${indicator.left}px)`,
              }}
            />
          ) : null}

          {selectedKeyGroups.length === 0 ? (
            <div
              className={`${styles.keyGroupTab} ${styles.keyGroupTabOn}`}
              role="tab"
              aria-selected="true"
            >
              <span className={styles.keyGroupTabName}>默认分组</span>
            </div>
          ) : (
            selectedKeyGroups.map((group) => {
              const selected = group.id === activeGroup?.id
              return (
                <div
                  key={group.id}
                  ref={(element) => {
                    if (element) tabRefs.current.set(group.id, element)
                    else tabRefs.current.delete(group.id)
                  }}
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
                  onDoubleClick={(event) => {
                    stop(event)
                    if (group.id !== activeGroup?.id) onActiveGroupChange(group.id)
                    beginRename(group)
                  }}
                  onContextMenu={(event) => openMenu(group, event)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    selectGroup(group.id)
                  }}
                >
                  {renderName(group, selected)}

                  {selected ? (
                    priorityId === group.id ? (
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
                        tabIndex={0}
                        title="修改分组优先级"
                        onClick={(event) => {
                          stop(event)
                          setPriorityId(group.id)
                        }}
                      >
                        P{group.priority}
                      </button>
                    )
                  ) : null}
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

      {menu
        ? createPortal(
            <SettingsKeyGroupMenuView
              menuRef={menuRef}
              name={menu.name}
              left={menu.left}
              top={menu.top}
              confirm={menuConfirm}
              busy={busy}
              canDelete={selectedKeyGroups.length > 1}
              onEdit={() => {
                const group = selectedKeyGroups.find((item) => item.id === menu.groupId)
                if (group) beginRename(group)
                else setMenu(null)
              }}
              onRequestDelete={() => setMenuConfirm(true)}
              onConfirmDelete={() => {
                const groupId = menu.groupId
                setMenu(null)
                setMenuConfirm(false)
                void onRemoveKeyGroup(groupId)
              }}
              onCancelDelete={() => setMenuConfirm(false)}
            />,
            document.body,
          )
        : null}
    </section>
  )
}

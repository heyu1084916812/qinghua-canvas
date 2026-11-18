import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { ChannelCredentialGroup } from '../../../domain/project/channel'
import { IconPlus } from '../../../app/ProjectTreeIcons'
import { KEY_GROUP_MENU_WIDTH, SettingsKeyGroupMenuView } from './SettingsKeyGroupMenuView'
import { FolderTabMorphLayer, FolderTabShape } from './FolderTabShape'
import { useFolderTabMorph } from './useFolderTabMorph'
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

  const menuRef = useRef<HTMLDivElement | null>(null)
  /* 双击还没选中的标题时，先切组再进编辑：这次 activeGroup 变化不能把刚打开的输入框关掉。 */
  const renameTargetRef = useRef<string | null>(null)
  const { tabRefs, tabsHostRef, morphSvgRef, morphPathRef, tabSizes } = useFolderTabMorph(
    activeGroup?.id,
  )

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
        <div className={styles.keyGroupTabs} role="tablist" aria-label="Key 分组" ref={tabsHostRef}>
          {selectedKeyGroups.length === 0 ? (
            <div
              className={`${styles.keyGroupTab} ${styles.keyGroupTabOn}`}
              role="tab"
              aria-selected="true"
              data-key-group-placeholder
            >
              <FolderTabShape width={140} height={40} first />
              <span className={styles.keyGroupTabInner}>
                <span className={styles.keyGroupTabName}>默认分组</span>
              </span>
            </div>
          ) : (
            selectedKeyGroups.map((group, index) => {
              const selected = group.id === activeGroup?.id
              const size = tabSizes[group.id]
              const shapeWidth = size?.w ?? 140
              const shapeHeight = size?.h ?? 40
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
                  data-key-group-first={index === 0 ? 'true' : undefined}
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
                  <FolderTabShape
                    width={shapeWidth}
                    height={shapeHeight}
                    first={index === 0}
                  />
                  <span className={styles.keyGroupTabInner}>
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

          {/* 选中标签的形变层：位置 / 宽度 / 高度都由弹簧实时驱动，画在静止梯形之上、文字之下 */}
          <FolderTabMorphLayer svgRef={morphSvgRef} pathRef={morphPathRef} />
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

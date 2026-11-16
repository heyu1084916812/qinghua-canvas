import { useEffect, useState, type ReactNode } from 'react'
import type { GenerationSource } from '../../../../domain/canvas/model/generationSource'
import { ChannelIcon } from '../../../../features/shared/channelIcon/ChannelIcon'
import { Icon, Lock, Settings } from '../../../../ui/icon'
import { ParamPicker } from '../ParamPicker'
import picker from '../ParamPicker.module.css'
import styles from './SourceModelMenu.module.css'
import {
  cliStatusText,
  type SourceSettingsAction,
  type SourceMenuIcon,
  type SourceMenuRow,
  type SourceMenuTab,
} from './sourceMenuModel'

/**
 * 创作面板的**模型菜单（内嵌来源切换）**（用户 2026-11-15 拍板，对账 #1133）。
 *
 * ```
 * [ API 9 | 工作流 2 | CLI 3 | ⚙ 设置 ]  ← 前三个只是「看」，不改节点；设置跟随当前标签
 *   分组 → 行（选中项打勾；CLI 行右侧状态点）
 * ```
 *
 * - 打开时停在节点**当前来源**；切标签只换列表，**点了某一行才真正切来源和模型**；
 * - 每个标签的勾 = 这个来源**上次选的那一项**（节点按来源存档）；
 * - 网页版 CLI 标签置灰锁住，悬停说明要桌面版；空标签一句话 + 「去设置」。
 * - 第四枚「设置」是动作不是来源：API → 渠道设置，工作流 → 管理页，CLI → 本机 CLI 设置。
 *
 * 外壳（chip、定位、点外关闭）复用 `ParamPicker`，样式复用它的行类，只补标签 / 状态点。
 */
export interface SourceModelMenuProps {
  tabs: SourceMenuTab[]
  /** chip 的无障碍名；缺省「模型与来源」 */
  ariaLabel?: string
  source: GenerationSource
  /** 每个来源上次选中的那一行的 value（打勾用） */
  selected: Partial<Record<GenerationSource, string>>
  label: string
  /** chip 上那枚当前项的图标（来源角标之后） */
  icon?: ReactNode
  iconFor: (icon: SourceMenuIcon) => ReactNode
  open: boolean
  onToggle: () => void
  onClose: () => void
  onPick: (row: SourceMenuRow) => void
  onSettings: (action: SourceSettingsAction) => void
  disabled?: boolean
}

export function SourceModelMenu(props: SourceModelMenuProps) {
  const { tabs, source, open } = props
  const [active, setActive] = useState<GenerationSource>(source)
  /** 每次打开都回到节点当前来源 */
  useEffect(() => {
    if (open) setActive(source)
  }, [open, source])
  const tab = tabs.find((item) => item.source === active) ?? tabs[0]!
  const groups = tab.groups
  const pick = (row: SourceMenuRow) => {
    props.onPick(row)
    props.onClose()
  }
  const openSettings = (action: SourceSettingsAction) => {
    props.onClose()
    props.onSettings(action)
  }

  const body = (
    <div className={styles.menu} data-source-menu={active}>
      <div className={styles.tabs}>
        <div className={styles.tabList} role="tablist" aria-label="生成来源">
          {tabs.map((item) => (
            <button
              key={item.source}
              type="button"
              role="tab"
              aria-selected={item.source === active}
              className={item.source === active ? `${styles.tab} ${styles.tabOn}` : styles.tab}
              data-source-tab={item.source}
              data-source-tab-locked={item.locked ? 'true' : undefined}
              disabled={Boolean(item.locked)}
              title={item.locked}
              onClick={() => setActive(item.source)}
            >
              <span>{item.label}</span>
              {item.locked ? <Icon icon={Lock} px={12} /> : <span className={styles.count}>{item.count}</span>}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`${styles.tab} ${styles.settings}`}
          data-source-settings={tab.settings.action}
          aria-label={tab.settings.label}
          title={tab.settings.label}
          onClick={() => openSettings(tab.settings.action)}
        >
          <Icon icon={Settings} px={14} />
          <span>设置</span>
        </button>
      </div>
      {tab.count === 0 ? (
        <div className={styles.empty} data-source-empty={tab.source}>
          <span>{tab.empty}</span>
          <button type="button" className={styles.emptyGo} data-source-empty-go={tab.settings.action} onClick={() => openSettings(tab.settings.action)}>
            去设置
          </button>
        </div>
      ) : (
        <div className={styles.groups}>
          {groups.map((group) => (
            <div key={group.label || 'all'} className={styles.group} data-source-group={group.label}>
              {group.label ? <span className={picker.sectionTitle}>{group.label}</span> : null}
              {group.rows.map((row) => {
                const on = props.selected[tab.source] === row.value
                return (
                  <button
                    key={row.value}
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={[picker.row, on ? picker.rowOn : '', row.status === 'missing' ? styles.rowMissing : ''].filter(Boolean).join(' ')}
                    data-source-option={row.value}
                    disabled={row.disabled}
                    title={row.title}
                    onClick={() => pick(row)}
                  >
                    <span className={picker.rowIcon}>{props.iconFor(row.icon)}</span>
                    {/* 有话说才两行（「还没有渠道提供」/ 站点·参数）；否则只有名字，回到 46px 单行高 */}
                    {row.hint ? (
                      <span className={picker.rowBody}>
                        <span className={picker.rowText}>{row.label}</span>
                        <span className={picker.rowHint}>{row.hint}</span>
                      </span>
                    ) : (
                      <span className={picker.rowText}>{row.label}</span>
                    )}
                    {row.status ? (
                      <span className={styles.status} data-cli-status={row.status}>
                        <span className={styles.dot} aria-hidden="true" />
                        {cliStatusText(row.status)}
                      </span>
                    ) : on ? (
                      <span className={picker.check} aria-hidden="true">✓</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <ParamPicker
      name="model"
      ariaLabel={props.ariaLabel ?? '模型与来源'}
      label={props.label}
      triggerIcon={props.icon}
      body={body}
      bodyKey={active}
      open={open}
      onToggle={props.onToggle}
      onClose={props.onClose}
      disabled={props.disabled === true}
    />
  )
}

/** 行图标：API 用厂商 logo（由面板给），工作流 / CLI 用渠道品牌图标 */
export function channelIconFor(protocol: string): ReactNode {
  return <ChannelIcon protocol={protocol} size={18} />
}

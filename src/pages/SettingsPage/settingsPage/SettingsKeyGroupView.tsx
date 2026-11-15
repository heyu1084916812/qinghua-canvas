import type { Channel, ChannelCredentialGroup } from '../../../domain/project/channel'
import type { ChannelStore } from '../../../state/channel/channelStore'
import { ChannelTokenField } from '../SettingsChannelTokenField'
import { settingsPageStyles as styles } from './settingsPageStyles'

/**
 * 渠道连接区的「Key 分组」。
 *
 * 为什么单独拆出来：`SettingsConnectionView` 已经贴着 389 行的预算，
 * 而这一段本身就是一整套独立交互（标签页 / 令牌字段 / 分组设置），
 * 留在父组件里会把「地址 + 协议 + 操作行」挤得没地方排（用户 2026-11-15：
 * 「后台渠道的位置不要全部塞在一起了」）。
 *
 * 与参考截图（图一）的关系：那一页只有一个「API Key」字段；我们多出来的
 * 分组名称 / 优先级 / 删除分组属于**进阶**，收进一个默认折叠的「分组设置」，
 * 让第一眼看到的仍然是一行 Key。
 */
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
  if (!activeGroup) {
    const slots = credentialSlots.length > 0 ? credentialSlots : [{ id: 'primary', label: '令牌（API Key）' }]
    return (
      <>
        {slots.map((cred, index) => (
          <ChannelTokenField
            key={cred.id}
            channels={channels}
            channelId={selected.id}
            slot={index === 0 ? 'primary' : 'alt'}
            label={cred.label}
            hint={cred.hint}
            required={cred.required}
            docUrl={docUrl}
            savedTail={index === 0 ? selected.tokenTail : selected.altTokenTail}
            saved={index === 0 ? selected.hasToken : selected.hasAltToken}
          />
        ))}
      </>
    )
  }

  return (
    <div className={styles.keyGroups} data-key-groups>
      <div className={styles.keyGroupsHead}>
        <span className={styles.label}>Key 分组</span>
        <button className={styles.ghostBtn} data-key-group-add disabled={busy} onClick={() => void onAddKeyGroup()}>
          + 添加分组
        </button>
      </div>
      <div className={styles.keyGroupTabs} role="tablist" aria-label="Key 分组">
        {selectedKeyGroups.map((group) => (
          <button
            key={group.id}
            type="button"
            role="tab"
            aria-selected={group.id === activeGroup.id}
            className={group.id === activeGroup.id ? `${styles.keyGroupTab} ${styles.keyGroupTabOn}` : styles.keyGroupTab}
            data-key-group-tab={group.id}
            onClick={() => onActiveGroupChange(group.id)}
          >
            {group.name}
            {group.hasToken ? '' : ' · 未填 Key'}
          </button>
        ))}
      </div>

      {/* Key 本身永远露着（参考图一就是一行 Key）；分组名称/优先级/删除收进折叠 */}
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

      <details className={styles.disclosure} data-key-group-settings>
        <summary>
          分组设置 · {activeGroup.name} · 优先级 {activeGroup.priority}
        </summary>
        <div className={styles.keyGroupEditor} data-key-group-editor={activeGroup.id}>
          <div className={styles.fieldRow}>
            <label className={`${styles.field} ${styles.grow}`}>
              <span className={styles.label}>分组名称</span>
              <input
                key={`${activeGroup.id}-name`}
                className={styles.input}
                data-key-group-name
                defaultValue={activeGroup.name}
                onBlur={(event) => {
                  const value = event.target.value.trim()
                  if (value && value !== activeGroup.name) onRenameKeyGroup(activeGroup.id, value)
                }}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>分组优先级</span>
              <input
                key={`${activeGroup.id}-priority`}
                className={`${styles.input} ${styles.numInput}`}
                type="number"
                data-key-group-priority
                defaultValue={activeGroup.priority}
                onBlur={(event) => {
                  const value = Number(event.target.value)
                  if (Number.isFinite(value) && value !== activeGroup.priority) {
                    onSetKeyGroupPriority(activeGroup.id, value)
                  }
                }}
              />
            </label>
          </div>
          <div className={styles.keyGroupFoot}>
            <span className={styles.cardSub}>每组独立保存 Key 和模型，优先级高的先请求。</span>
            <button
              className={styles.ghostBtn}
              data-key-group-remove
              disabled={busy || selectedKeyGroups.length <= 1}
              onClick={() => void onRemoveKeyGroup()}
            >
              删除分组
            </button>
          </div>
        </div>
      </details>
    </div>
  )
}

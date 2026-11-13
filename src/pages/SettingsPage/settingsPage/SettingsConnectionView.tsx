import type { ReactNode } from 'react'
import type { ProtocolDefinition } from '../../../domain/project/protocol'
import type { DeclarativeProtocolPackage } from '../../../domain/project/protocolRecipe'
import type { Channel, ChannelCredentialGroup } from '../../../domain/project/channel'
import type { ChannelStore } from '../../../state/channel/channelStore'
import {
  IconDelete,
  IconDownload,
} from '../../../app/SettingsIcons'
import { noticeA11y } from '../../../domain/ui/notice'
import { ChoicePicker } from '../../../features/shared/choicePicker/ChoicePicker'
import { ChannelTokenField } from '../SettingsChannelTokenField'
import { PROTOCOL_GROUPS } from '../settingsPageConstants'
import { SettingsProtocolDetailsView } from './SettingsProtocolDetailsView'
import { settingsPageStyles as styles } from './settingsPageStyles'

type CredentialSlot = {
  id: string
  label: string
  hint?: string
  required?: boolean
}

export type SettingsConnectionViewProps = {
  channels: ChannelStore
  selected: Channel
  baseUrl: string
  busy: boolean
  activeGroup: ChannelCredentialGroup | null
  selectedKeyGroups: ChannelCredentialGroup[]
  credentialSlots: CredentialSlot[]
  docUrl: string
  protocol: string
  builtinSelected: boolean
  visibleProtocolOptions: ProtocolDefinition[]
  pendingProtocols: ProtocolDefinition[]
  referencedProtocolIds: ReadonlySet<string>
  statusLine: ReactNode
  statusTone: Parameters<typeof noticeA11y>[0]
  showMockNote: boolean
  selectedProtocolNote: string
  newProtoOpen: boolean
  hiddenBuiltinProtocolCount: number
  npNotice: string
  protoManageNotice: string
  protoRemoveError: string
  npImportText: string
  npImported: DeclarativeProtocolPackage | null
  npError: string
  onBaseUrlChange: (value: string) => void
  onPersistForm: () => unknown
  onAddKeyGroup: () => Promise<void>
  onRemoveKeyGroup: () => Promise<void>
  onActiveGroupChange: (groupId: string) => void
  onRenameKeyGroup: (groupId: string, name: string) => void
  onSetKeyGroupPriority: (groupId: string, priority: number) => void
  onProtocolChange: (protocol: string) => void
  onDownloadProtocol: (protocol: ProtocolDefinition) => void
  onRemoveProtocol: (protocol: ProtocolDefinition) => void
  onDetect: () => void
  onVerify: () => void
  onToggleNewProtocol: () => void
  onRestoreBuiltinProtocols: () => void
  onDownloadProtocolTemplate: () => void
  onImportProtocolFile: (file: File | undefined) => void
  onImportTextChange: (value: string) => void
  onClearImported: () => void
  onClearImportError: () => void
  onCheckImportedProtocol: () => void
  onSaveImportedProtocol: () => void
}

export function SettingsConnectionView({
  channels,
  selected,
  baseUrl,
  busy,
  activeGroup,
  selectedKeyGroups,
  credentialSlots,
  docUrl,
  protocol,
  builtinSelected,
  visibleProtocolOptions,
  pendingProtocols,
  referencedProtocolIds,
  statusLine,
  statusTone,
  showMockNote,
  selectedProtocolNote,
  newProtoOpen,
  hiddenBuiltinProtocolCount,
  npNotice,
  protoManageNotice,
  protoRemoveError,
  npImportText,
  npImported,
  npError,
  onBaseUrlChange,
  onPersistForm,
  onAddKeyGroup,
  onRemoveKeyGroup,
  onActiveGroupChange,
  onRenameKeyGroup,
  onSetKeyGroupPriority,
  onProtocolChange,
  onDownloadProtocol,
  onRemoveProtocol,
  onDetect,
  onVerify,
  onToggleNewProtocol,
  onRestoreBuiltinProtocols,
  onDownloadProtocolTemplate,
  onImportProtocolFile,
  onImportTextChange,
  onClearImported,
  onClearImportError,
  onCheckImportedProtocol,
  onSaveImportedProtocol,
}: SettingsConnectionViewProps) {
  const protocolChoices = [
    ...(!visibleProtocolOptions.some((item) => item.id === protocol)
      ? [
          {
            value: protocol,
            label: `未知协议（${protocol}）`,
            group: '当前协议',
          },
        ]
      : []),
    ...PROTOCOL_GROUPS.flatMap(({ kind, label }) =>
      visibleProtocolOptions
        .filter((item) => item.kind === kind)
        .map((item) => ({
          value: item.id,
          label: `${item.name}${item.status !== 'ready' ? '（待支持）' : ''}`,
          group: label,
          disabled: item.status !== 'ready',
          actions:
            item.kind === 'station' || item.kind === 'custom'
              ? [
                  {
                    key: 'download',
                    label: `下载协议 ${item.name}`,
                    title: '下载协议',
                    icon: <IconDownload size="sm" />,
                    onSelect: () => onDownloadProtocol(item),
                  },
                  {
                    key: 'delete',
                    label: `删除协议 ${item.name}`,
                    title: referencedProtocolIds.has(item.id)
                      ? '仍有渠道使用，先切换渠道协议再删除'
                      : '删除协议',
                    icon: <IconDelete size="sm" />,
                    danger: true,
                    disabled: referencedProtocolIds.has(item.id),
                    onSelect: () => onRemoveProtocol(item),
                  },
                ]
              : undefined,
        })),
    ),
  ]

  return (
    <section className={styles.editorSection} data-settings-connection>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>连接与鉴权</span>
        <span className={styles.cardSub}>站点地址、API Key 与协议</span>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>地址</span>
        <input
          className={styles.input}
          data-settings-baseurl
          placeholder="https://your-relay.example.com（含 /v1 或不含都可以）"
          value={baseUrl}
          onChange={(event) => onBaseUrlChange(event.target.value)}
          onBlur={() => void onPersistForm()}
        />
      </label>

      {activeGroup ? (
        <div className={styles.keyGroups} data-key-groups>
          <div className={styles.keyGroupsHead}>
            <span className={styles.label}>Key 分组</span>
            <button
              className={styles.ghostBtn}
              data-key-group-add
              disabled={busy}
              onClick={() => void onAddKeyGroup()}
            >
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
                className={
                  group.id === activeGroup.id
                    ? `${styles.keyGroupTab} ${styles.keyGroupTabOn}`
                    : styles.keyGroupTab
                }
                data-key-group-tab={group.id}
                onClick={() => onActiveGroupChange(group.id)}
              >
                {group.name}
                {group.hasToken ? '' : ' · 未填 Key'}
              </button>
            ))}
          </div>

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
                    if (value && value !== activeGroup.name) {
                      onRenameKeyGroup(activeGroup.id, value)
                    }
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
            <div className={styles.keyGroupFoot}>
              <span className={styles.cardSub}>
                每组独立保存 Key 和模型，优先级高的先请求。
              </span>
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
        </div>
      ) : (
        (credentialSlots.length > 0
          ? credentialSlots
          : [{ id: 'primary', label: '令牌（API Key）' }]
        ).map((cred, index) => (
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
        ))
      )}

      <div className={styles.protocolRow}>
        <label className={`${styles.field} ${styles.grow}`}>
          <span className={styles.label}>协议</span>
          <ChoicePicker
            name="settings-protocol"
            value={protocol}
            ariaLabel="渠道协议"
            disabled={builtinSelected}
            onChange={onProtocolChange}
            options={protocolChoices}
          />
        </label>
        <button
          className={styles.ghostBtn}
          data-settings-detect
          disabled={busy}
          onClick={onDetect}
          title="按候选协议逐个试打，第一个通的自动选中"
        >
          验证协议
        </button>
        <button
          className={styles.ghostBtn}
          data-settings-verify
          disabled={busy}
          onClick={onVerify}
        >
          验证地址
        </button>
      </div>

      <div
        className={styles.status}
        data-settings-status
        data-status-tone={statusTone}
        {...noticeA11y(statusTone)}
      >
        {statusLine}
      </div>

      <div className={styles.protoTools}>
        <button
          className={styles.ghostBtn}
          data-proto-add-toggle
          onClick={onToggleNewProtocol}
        >
          {newProtoOpen ? '收起 AI 协议导入' : '导入 AI 协议'}
        </button>
        {hiddenBuiltinProtocolCount > 0 && (
          <button
            type="button"
            className={styles.ghostBtn}
            data-proto-restore
            onClick={onRestoreBuiltinProtocols}
          >
            恢复已移除（{hiddenBuiltinProtocolCount}）
          </button>
        )}
        {npNotice && <span className={styles.saved}>{npNotice}</span>}
        {protoManageNotice && (
          <span className={styles.saved} data-proto-manage-notice>
            {protoManageNotice}
          </span>
        )}
        {protoRemoveError && (
          <span className={styles.protoInlineError} data-proto-remove-error>
            {protoRemoveError}
          </span>
        )}
      </div>

      <SettingsProtocolDetailsView
        protocol={protocol}
        pendingProtocols={pendingProtocols}
        showMockNote={showMockNote}
        selectedProtocolNote={selectedProtocolNote}
        newProtoOpen={newProtoOpen}
        npImportText={npImportText}
        npImported={npImported}
        npError={npError}
        onDownloadProtocolTemplate={onDownloadProtocolTemplate}
        onImportProtocolFile={onImportProtocolFile}
        onImportTextChange={onImportTextChange}
        onClearImported={onClearImported}
        onClearImportError={onClearImportError}
        onCheckImportedProtocol={onCheckImportedProtocol}
        onSaveImportedProtocol={onSaveImportedProtocol}
      />
    </section>
  )
}

import { CAPABILITY_LABEL, type ProtocolDefinition } from '../../../domain/project/protocol'
import type { DeclarativeProtocolPackage } from '../../../domain/project/protocolRecipe'
import { settingsPageStyles as styles } from './settingsPageStyles'

export type SettingsProtocolDetailsViewProps = {
  protocol: string
  pendingProtocols: ProtocolDefinition[]
  showMockNote: boolean
  selectedProtocolNote: string
  newProtoOpen: boolean
  npImportText: string
  npImported: DeclarativeProtocolPackage | null
  npError: string
  onDownloadProtocolTemplate: () => void
  onImportProtocolFile: (file: File | undefined) => void
  onImportTextChange: (value: string) => void
  onClearImported: () => void
  onClearImportError: () => void
  onCheckImportedProtocol: () => void
  onSaveImportedProtocol: () => void
}

export function SettingsProtocolDetailsView({
  protocol,
  pendingProtocols,
  showMockNote,
  selectedProtocolNote,
  newProtoOpen,
  npImportText,
  npImported,
  npError,
  onDownloadProtocolTemplate,
  onImportProtocolFile,
  onImportTextChange,
  onClearImported,
  onClearImportError,
  onCheckImportedProtocol,
  onSaveImportedProtocol,
}: SettingsProtocolDetailsViewProps) {
  return (
    <>
      {newProtoOpen && (
        <div className={styles.protoForm} data-proto-form>
          <p className={styles.protoLead}>
            普通中转站直接选「OpenAI 兼容」。只有接口格式不同才需要导入 AI 协议。
          </p>
          <p className={styles.protoLead}>
            下载模板后，把模板和站点 API 文档一起交给 AI。AI 只输出协议 JSON，
            这里负责校验和保存。
          </p>
          <div className={styles.protoImportActions}>
            <button
              type="button"
              className={styles.ghostBtn}
              data-proto-template-download
              onClick={onDownloadProtocolTemplate}
            >
              下载协议模板
            </button>
            <label className={styles.ghostBtn} data-proto-file-label>
              选择 .txt / .json
              <input
                type="file"
                accept=".txt,.json,text/plain,application/json"
                hidden
                data-proto-file
                onChange={(event) => {
                  onImportProtocolFile(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
            </label>
          </div>
          <textarea
            className={styles.protoImportText}
            data-proto-import-text
            placeholder="粘贴 AI 生成的协议内容"
            value={npImportText}
            onChange={(event) => {
              onImportTextChange(event.target.value)
              onClearImported()
              onClearImportError()
            }}
          />
          {npImported && (
            <div className={styles.protoPreview} data-proto-preview>
              <strong>{npImported.name}</strong>
              <span>
                {npImported.capabilities
                  .map((capability) => CAPABILITY_LABEL[capability])
                  .join(' / ')}
              </span>
              <span>{npImported.recipe.auth.type} 鉴权</span>
            </div>
          )}
          {npError && (
            <p className={styles.protoError} data-proto-error>
              {npError}
            </p>
          )}
          <div className={styles.protoFoot}>
            <button
              className={styles.ghostBtn}
              data-proto-check
              onClick={onCheckImportedProtocol}
            >
              检查协议
            </button>
            <button
              className={styles.primary}
              data-proto-import-save
              onClick={onSaveImportedProtocol}
            >
              保存并选中
            </button>
          </div>
        </div>
      )}

      {pendingProtocols.length > 0 && (
        <div className={styles.protoMine} data-proto-pending>
          <span className={styles.label}>待支持协议</span>
          {pendingProtocols.map((pendingProtocol) => (
            <div
              key={pendingProtocol.id}
              className={styles.protoMineRow}
              data-proto-pending-item={pendingProtocol.id}
            >
              <span className={styles.protoMineName}>{pendingProtocol.name}</span>
              <span className={styles.protoPendingWhy}>{pendingProtocol.note}</span>
            </div>
          ))}
        </div>
      )}

      {showMockNote && (
        <p className={styles.offlineNote} data-settings-mock-note>
          Mock 是离线协议：不发任何网络请求、也不会去访问上面填的地址，所以验证必然通过。
          要联调真实中转，把「协议」切到「OpenAI 兼容（对话 + 生图）」后再点一次「验证地址」，
          或者直接点「验证协议」让它自己认。
        </p>
      )}
      {selectedProtocolNote && protocol !== 'mock' && (
        <p className={styles.offlineNote} data-settings-proto-note>
          {selectedProtocolNote}
        </p>
      )}
    </>
  )
}

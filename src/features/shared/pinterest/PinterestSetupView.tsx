import { openUrl } from '@tauri-apps/plugin-opener'
import type { PinterestConnection } from '../../../state/project/pinterestConnectionStore'
import styles from './PinterestPanel.module.css'

export interface PinterestSetupViewProps {
  busy: string
  connection: PinterestConnection | null
  clientId: string
  clientSecret: string
  redirectUri: string
  manualCallback: string
  onClientId: (value: string) => void
  onClientSecret: (value: string) => void
  onRedirectUri: (value: string) => void
  onManualCallback: (value: string) => void
  onSave: () => void
  onAuthorize: () => void
  onManualSubmit: () => void
}

export function PinterestSetupView(props: PinterestSetupViewProps) {
  return (
    <div className={styles.setup}>
      <div className={styles.step}>
        <strong>1. 创建 Pinterest Developer App</strong>
        <p>
          在 Pinterest 开发者后台创建应用，勾选 <code>boards:read</code>、
          <code>pins:read</code> 和 <code>user_accounts:read</code>。
        </p>
        <button
          type="button"
          className={styles.linkBtn}
          onClick={() => void openUrl('https://developers.pinterest.com/apps/')}
        >
          打开开发者后台
        </button>
      </div>
      <div className={styles.fields}>
        <label>
          <span>Client ID</span>
          <input
            value={props.clientId}
            data-pinterest-client-id
            onChange={(event) => props.onClientId(event.target.value)}
          />
        </label>
        <label>
          <span>Client Secret</span>
          <input
            type="password"
            value={props.clientSecret}
            placeholder={props.connection?.hasClientSecret ? '已加密保存；留空则保持不变' : ''}
            data-pinterest-client-secret
            onChange={(event) => props.onClientSecret(event.target.value)}
          />
        </label>
        <label className={styles.wide}>
          <span>Redirect URI</span>
          <input
            value={props.redirectUri}
            data-pinterest-redirect-uri
            onChange={(event) => props.onRedirectUri(event.target.value)}
          />
          <small>
            本机 HTTP 回调可使用自动登录；若开发者后台只接受 HTTPS，请填写已登记地址并手动粘贴回调。
          </small>
        </label>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondary}
          disabled={Boolean(props.busy)}
          onClick={props.onSave}
        >
          只保存配置
        </button>
        <button
          type="button"
          className={styles.primary}
          data-pinterest-authorize
          disabled={
            Boolean(props.busy) ||
            !props.clientId.trim() ||
            (!props.clientSecret.trim() && !props.connection?.hasClientSecret)
          }
          onClick={props.onAuthorize}
        >
          {props.busy === 'authorize' ? '等待授权…' : '登录并授权'}
        </button>
      </div>
      <details className={styles.manual}>
        <summary>自动回调不可用时，手动粘贴回调地址</summary>
        <input
          value={props.manualCallback}
          data-pinterest-callback-url
          placeholder="http://127.0.0.1:53682/pinterest/callback?code=…&state=…"
          onChange={(event) => props.onManualCallback(event.target.value)}
        />
        <button
          type="button"
          className={styles.secondary}
          disabled={Boolean(props.busy) || !props.manualCallback.trim()}
          onClick={props.onManualSubmit}
        >
          完成授权
        </button>
      </details>
    </div>
  )
}

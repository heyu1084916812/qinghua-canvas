import { openUrl } from '@tauri-apps/plugin-opener'
import type { PinterestConnection } from '../../../state/project/pinterestConnectionStore'
import styles from './PinterestPanel.module.css'
import setupStyles from './PinterestSetupView.module.css'
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
      <div className={setupStyles.setupIntro}>
        <strong>连接你的 Pinterest 账号</strong>
        <p>
          授权后可读取你的收藏板和收藏图片，再保存到素材库或导入当前画布。
        </p>
      </div>
      <details className={setupStyles.developerHint}>
        <summary>如何获取应用信息</summary>
        <p>在 Pinterest 开发者后台创建应用，并开通收藏板、收藏图片和账号信息读取权限。</p>
        <button
          type="button"
          className={styles.linkBtn}
          onClick={() => void openUrl('https://developers.pinterest.com/apps/')}
        >
          打开 Pinterest 开发者后台
        </button>
      </details>
      <div className={styles.fields}>
        <label>
          <span>应用编号</span>
          <input
            value={props.clientId}
            data-pinterest-client-id
            placeholder="Pinterest 开发者后台中的应用编号"
            onChange={(event) => props.onClientId(event.target.value)}
          />
        </label>
        <label>
          <span>应用密钥</span>
          <input
            type="password"
            value={props.clientSecret}
            placeholder={props.connection?.hasClientSecret ? '已加密保存，留空保持不变' : '应用密钥只保存在本机'}
            data-pinterest-client-secret
            onChange={(event) => props.onClientSecret(event.target.value)}
          />
        </label>
        <label className={styles.wide}>
          <span>回调地址</span>
          <input
            value={props.redirectUri}
            data-pinterest-redirect-uri
            onChange={(event) => props.onRedirectUri(event.target.value)}
          />
        </label>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondary}
          disabled={Boolean(props.busy)}
          onClick={props.onSave}
        >
          保存配置
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
          {props.busy === 'authorize' ? '等待授权…' : '登录 Pinterest'}
        </button>
      </div>
      <details className={styles.manual}>
        <summary>高级设置：手动粘贴回调地址</summary>
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
